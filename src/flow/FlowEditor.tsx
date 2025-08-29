import { useCallback, useEffect, useMemo, useRef, useImperativeHandle, forwardRef } from 'react'
import ReactFlow, { Background, Controls, MarkerType, MiniMap, ReactFlowProvider, addEdge, type Connection, type Edge, type Node, Panel, useEdgesState, useNodesState, useReactFlow } from 'reactflow'
import 'reactflow/dist/style.css'
import type { PipelineNodeData } from './codegen'

// 초기 그래프: Start 노드 1개만 배치
const initialNodes: Node<PipelineNodeData>[] = [
  {
    id: 'start',
    position: { x: 50, y: 80 },
    data: { kind: 'start', label: 'Start' },
    type: 'default'
  }
]

export interface FlowEditorProps {
  onGraphChange?: (nodes: Node<PipelineNodeData>[], edges: Edge[]) => void
}

export interface FlowEditorRef {
  updateGraphFromYAML: (yamlContent: string) => void
  updateGraphFromShell: (shellContent: string) => void
}

// 실제 에디터 캔버스 컴포넌트 (Provider 내부에서만 동작)
const EditorCanvas = forwardRef<FlowEditorRef, FlowEditorProps>(({ onGraphChange }, ref) => {
  // React Flow 상태 훅: 노드/엣지 배열과 변경 핸들러를 반환
  const [nodes, setNodes, onNodesChange] = useNodesState<PipelineNodeData>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState([])

  // ReactFlow 인스턴스/좌표 변환에 사용
  const flowRef = useRef<HTMLDivElement>(null)
  const rf = useReactFlow()

  // 상위(App)로 그래프 변경 통지
  useEffect(() => {
    if (onGraphChange) {
      onGraphChange(nodes, edges)
    }
  }, [nodes, edges, onGraphChange])

  // YAML에서 파싱된 그래프로 업데이트
  const updateGraphFromYAML = useCallback((yamlContent: string) => {
    // parseYAMLToGraph 함수를 동적으로 import
    import('./codegen').then(({ parseYAMLToGraph }) => {
      const { nodes: newNodes, edges: newEdges } = parseYAMLToGraph(yamlContent)
      
      if (newNodes.length > 0) {
        // 새로운 노드와 엣지로 그래프 업데이트
        setNodes(newNodes)
        setEdges(newEdges)
        
        // 뷰를 새로운 그래프에 맞게 조정
        setTimeout(() => {
          rf.fitView({ padding: 0.1 })
        }, 100)
      }
    }).catch(error => {
      console.error('YAML 파싱 모듈 로드 오류:', error)
    })
  }, [setNodes, setEdges, rf])

  // Shell에서 파싱된 그래프로 업데이트
  const updateGraphFromShell = useCallback((shellContent: string) => {
    console.log('=== FlowEditor.updateGraphFromShell 호출됨 ===')
    console.log('받은 Shell 내용:', shellContent)
    
    // parseShellToGraph 함수를 동적으로 import
    import('./codegen').then(({ parseShellToGraph }) => {
      console.log('parseShellToGraph 함수 로드 완료')
      
      const { nodes: newNodes, edges: newEdges } = parseShellToGraph(shellContent)
      console.log('Shell 파싱 결과:', { newNodes, newEdges })
      
      if (newNodes.length > 0) {
        console.log('새로운 Shell 노드들을 그래프에 적용 중...')
        // 새로운 노드와 엣지로 그래프 업데이트
        setNodes(newNodes)
        setEdges(newEdges)
        
        // 뷰를 새로운 그래프에 맞게 조정
        setTimeout(() => {
          rf.fitView({ padding: 0.1 })
        }, 100)
        
        console.log('Shell 그래프 업데이트 완료')
      } else {
        console.warn('Shell에서 파싱된 노드가 없습니다')
      }
    }).catch(error => {
      console.error('Shell 파싱 모듈 로드 오류:', error)
    })
  }, [setNodes, setEdges, rf])

  // ref를 통해 외부에서 함수 호출 가능하도록 설정
  useImperativeHandle(ref, () => ({
    updateGraphFromYAML,
    updateGraphFromShell
  }), [updateGraphFromYAML, updateGraphFromShell])

  // 엣지 연결 시: 화살표와 애니메이션 추가
  const onConnect = useCallback((params: Edge | Connection) => {
    setEdges(e => {
      const newEdge = {
        ...params,
        type: 'smoothstep',
        animated: true,
        markerEnd: { 
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20
        }
      }
      return addEdge(newEdge, e)
    })
  }, [setEdges])

  // 팔레트 항목 → 사용자가 알아볼 라벨 생성
  const labelFor = (data: Partial<PipelineNodeData>): string => {
    switch (data.kind) {
      case 'git_clone': return 'Git Clone'
      case 'linux_install': return 'Linux Install'
      case 'prebuild_node': return `Prebuild Node (${data.manager || 'npm'})`
      case 'prebuild_python': return 'Prebuild Python'
      case 'prebuild_java': return 'Prebuild Java'
      case 'prebuild_custom': return 'Prebuild Custom'
      case 'build_npm': return 'Build NPM'
      case 'build_python': return 'Build Python'
      case 'build_java': return 'Build Java'
      case 'docker_build': return 'Docker Build'
      case 'run_tests': return `Run Tests (${data.testType || ''})`
      case 'deploy': return `Deploy (${data.environment || ''})`
      case 'notify_slack': return 'Notify Slack'
      case 'start': return 'Start'
      default: return data.kind || 'Node'
    }
  }

  // 노드 추가(클릭/드롭 공용). 위치 미지정 시 간단한 가로 오프셋 배치
  const addNode = useCallback((data: Partial<PipelineNodeData>, position?: { x: number, y: number }) => {
    setNodes(ns => {
      const id = `${data.kind}-${Date.now()}-${Math.round(Math.random()*1e4)}`
      const pos = position ?? { x: 100 + ns.length * 200, y: 200 }
      const node: Node<PipelineNodeData> = { id, position: pos, data: { label: labelFor(data), ...(data as PipelineNodeData) } }
      
      // 이전 노드가 있으면 자동으로 연결
      if (ns.length > 0) {
        const lastNode = ns[ns.length - 1]
        const edge: Edge = {
          id: `auto-edge-${lastNode.id}-${id}`,
          source: lastNode.id,
          target: id,
          type: 'smoothstep',
          animated: true,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20
          },
          label: `${ns.length}`,
          labelStyle: {
            fill: '#fff',
            fontWeight: 600,
            fontSize: '12px'
          },
          labelBgStyle: {
            fill: '#1a192b',
            fillOpacity: 0.8
          },
          labelBgPadding: [4, 4] as [number, number],
          labelBgBorderRadius: 4
        }
        
        setEdges(es => [...es, edge])
      }
      
      return [...ns, node]
    })
  }, [setNodes, setEdges])

  // 좌측 팔레트 정의 (드래그&클릭으로 추가)
  const palette = useMemo(() => [
    { label: 'Git Clone', data: { kind: 'git_clone' as const, repoUrl: 'https://github.com/user/repo.git', branch: 'main' } },
    { label: 'Linux Install', data: { kind: 'linux_install' as const, osPkg: 'apt' as const, packages: 'git curl' } },
    { label: 'Prebuild Node', data: { kind: 'prebuild_node' as const, manager: 'npm' as const } },
    { label: 'Prebuild Python', data: { kind: 'prebuild_python' as const } },
    { label: 'Prebuild Java', data: { kind: 'prebuild_java' as const } },
    { label: 'Prebuild Custom', data: { kind: 'prebuild_custom' as const, script: 'echo "custom prebuild"' } },
    { label: 'Build NPM', data: { kind: 'build_npm' as const } },
    { label: 'Build Python', data: { kind: 'build_python' as const } },
    { label: 'Build Java', data: { kind: 'build_java' as const } },
    { label: 'Docker Build', data: { kind: 'docker_build' as const, dockerfile: 'Dockerfile', tag: 'myapp:latest' } },
    { label: 'Run Tests', data: { kind: 'run_tests' as const, testType: 'unit' as const, command: 'npm test' } },
    { label: 'Deploy', data: { kind: 'deploy' as const, environment: 'staging' as const, deployScript: './deploy.sh' } },
    { label: 'Notify Slack', data: { kind: 'notify_slack' as const, channel: '#deployments', message: 'Deployment completed!' } }
  ], [])

  // 선형 순서를 계산하여 엣지 라벨(1,2,3...)과 화살표를 갱신
  useEffect(() => {
    // 간단한 방법: edges 배열의 순서대로 순서 번호 부여
    let changed = false
    const nextEdges = edges.map((e, index) => {
      const label = String(index + 1)
      const markerEnd = { 
        type: MarkerType.ArrowClosed,
        width: 20,
        height: 20
      }
      const needUpdate = e.label !== label || 
                        JSON.stringify(e.markerEnd) !== JSON.stringify(markerEnd) ||
                        e.type !== 'smoothstep' ||
                        !e.animated
      if (needUpdate) {
        changed = true
        return { 
          ...e, 
          label, 
          markerEnd,
          type: 'smoothstep',
          animated: true,
          labelStyle: {
            fill: '#fff',
            fontWeight: 600,
            fontSize: '12px'
          },
          labelBgStyle: {
            fill: '#1a192b',
            fillOpacity: 0.8
          },
          labelBgPadding: [4, 4] as [number, number],
          labelBgBorderRadius: 4
        }
      }
      return e
    })

    if (changed) setEdges(nextEdges)
    // 의존성: nodes/edges 변화 시 순서 라벨 재계산
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges])

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 12, height: '100%' }}>
      <div style={{ borderRight: '1px solid rgba(255,255,255,.15)', paddingRight: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Palette</div>
        {palette.map((p, idx) => (
          <button
            key={idx}
            draggable
            onDragStart={(e) => {
              // React Flow 드래그 페이로드 규약
              e.dataTransfer.setData('application/reactflow', JSON.stringify(p.data))
              e.dataTransfer.effectAllowed = 'move'
            }}
            onClick={() => addNode(p.data)}
            style={{ width: '100%', textAlign: 'left', marginBottom: 6 }}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div ref={flowRef} style={{ height: '100%', minHeight: 420, position: 'relative' }}>
        <ReactFlow
          style={{ width: '100%', height: '100%' }}
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={(instance) => { setTimeout(() => instance.fitView(), 0) }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
          onDrop={(e) => {
            e.preventDefault()
            const raw = e.dataTransfer.getData('application/reactflow')
            if (!raw) return
            const data = JSON.parse(raw) as Partial<PipelineNodeData>
            const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
            addNode(data, pos)
          }}
          selectionOnDrag
          deleteKeyCode={['Backspace', 'Delete']}
          fitView
        >
          <MiniMap />
          <Controls />
          <Background gap={16} size={1} />
          <Panel position="top-right">
            <span style={{ opacity: .8 }}>노드 {nodes.length} / 엣지 {edges.length}</span>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  )
})

// Provider로 감싼 래퍼. useReactFlow 훅 사용을 가능하게 함
export default function FlowEditor({ onGraphChange }: FlowEditorProps) {
  return (
    <ReactFlowProvider>
      <EditorCanvas onGraphChange={onGraphChange} />
    </ReactFlowProvider>
  )
}

// forwardRef를 사용한 래퍼 컴포넌트
export const FlowEditorWithRef = forwardRef<FlowEditorRef, FlowEditorProps>((props, ref) => {
  return (
    <ReactFlowProvider>
      <EditorCanvas ref={ref} onGraphChange={props.onGraphChange} />
    </ReactFlowProvider>
  )
})



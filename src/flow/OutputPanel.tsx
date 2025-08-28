import { useEffect, useMemo, useState } from 'react'
import type { Edge, Node } from 'reactflow'
import { generateShell, generateYAML } from './codegen'
import type { PipelineNodeData } from './codegen'

/**
 * 그래프 상태를 받아 YAML / Shell 출력을 실시간으로 보여주는 패널
 * - 탭 전환으로 두 가지 포맷을 확인
 * - 복사/다운로드 버튼을 쉽게 추가할 수 있도록 구조를 단순히 유지
 */

export interface OutputPanelProps {
  nodes: Node<PipelineNodeData>[]
  edges: Edge[]
}

export default function OutputPanel({ nodes, edges }: OutputPanelProps) {
  const [tab, setTab] = useState<'yaml' | 'shell'>('yaml')

  const shell = useMemo(() => generateShell(nodes, edges), [nodes, edges])
  const yaml = useMemo(() => generateYAML(nodes, edges), [nodes, edges])

  useEffect(() => {
    // no-op; place for future side effects (copy buttons etc.)
  }, [tab])

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid rgba(255,255,255,.15)', paddingBottom: 8, marginBottom: 8 }}>
        <button onClick={() => setTab('yaml')} className={tab === 'yaml' ? 'active' : ''}>YAML</button>
        <button onClick={() => setTab('shell')} className={tab === 'shell' ? 'active' : ''}>Shell</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'yaml' ? (
          <pre style={{ whiteSpace: 'pre-wrap' }}>{yaml}</pre>
        ) : (
          <pre style={{ whiteSpace: 'pre-wrap' }}>{shell}</pre>
        )}
      </div>
    </div>
  )
}



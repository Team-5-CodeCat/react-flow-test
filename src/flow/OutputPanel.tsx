import { useEffect, useMemo, useState } from 'react'
import type { Edge, Node } from 'reactflow'
import { generateYAML, generateShell, generateShellFromYAML, generateYAMLFromShell } from './codegen'
import type { PipelineNodeData } from './codegen'

/**
 * 그래프 상태를 받아 YAML / Shell 출력을 실시간으로 보여주는 패널
 * - 탭 전환으로 두 가지 포맷을 확인
 * - 코드를 클릭하면 편집 가능한 textarea로 변경
 * - 편집된 내용을 저장할 수 있음
 */

export interface OutputPanelProps {
  nodes: Node<PipelineNodeData>[]
  edges: Edge[]
  onYAMLUpdate?: (yamlContent: string) => void
  onShellUpdate?: (shellContent: string) => void
}

export default function OutputPanel({ nodes, edges, onYAMLUpdate, onShellUpdate }: OutputPanelProps) {
  const [tab, setTab] = useState<'yaml' | 'shell'>('yaml')
  const [isEditing, setIsEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [editingTab, setEditingTab] = useState<'yaml' | 'shell' | null>(null)
  const [lastSavedYAML, setLastSavedYAML] = useState('') // 마지막으로 저장된 YAML 저장
  const [lastSavedShell, setLastSavedShell] = useState('') // 마지막으로 저장된 Shell 저장

  const shell = useMemo(() => generateShell(nodes, edges), [nodes, edges])
  const yaml = useMemo(() => generateYAML(nodes, edges), [nodes, edges])

  useEffect(() => {
    // no-op; place for future side effects (copy buttons etc.)
  }, [tab])

  const handleCodeClick = (content: string, tabType: 'yaml' | 'shell') => {
    setEditedContent(content)
    setEditingTab(tabType)
    setIsEditing(true)
  }

  const handleSave = () => {
    // YAML 편집 시에만 onYAMLUpdate 호출
    if (editingTab === 'yaml' && onYAMLUpdate) {
      onYAMLUpdate(editedContent)
      setLastSavedYAML(editedContent) // 저장된 YAML 내용을 저장
      
      // YAML이 변경되면 그에 맞는 Shell 코드도 자동 생성
      try {
        const newShell = generateShellFromYAML(editedContent)
        setLastSavedShell(newShell)
        console.log('YAML 변경으로 Shell 자동 생성:', newShell)
      } catch (error) {
        console.error('Shell 자동 생성 실패:', error)
        setLastSavedShell('') // 실패 시 Shell 초기화
      }
    } else if (editingTab === 'shell') {
      // Shell 편집 시에는 Shell만 저장
      setLastSavedShell(editedContent)
      
      // Shell 편집 시 onShellUpdate 호출
      if (onShellUpdate) {
        onShellUpdate(editedContent)
      }
      
      // Shell이 변경되면 그에 맞는 YAML 코드도 자동 생성
      try {
        const newYAML = generateYAMLFromShell(editedContent)
        setLastSavedYAML(newYAML)
        console.log('Shell 변경으로 YAML 자동 생성:', newYAML)
      } catch (error) {
        console.error('YAML 자동 생성 실패:', error)
        setLastSavedYAML('') // 실패 시 YAML 초기화
      }
    }
    
    // 여기서 편집된 내용을 처리할 수 있습니다
    console.log(`Saved ${editingTab} content:`, editedContent)
    setIsEditing(false)
    setEditingTab(null)
    setEditedContent('')
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditingTab(null)
    setEditedContent('')
  }

  const renderContent = () => {
    if (isEditing) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ marginBottom: '10px', fontSize: '14px', color: '#888' }}>
            편집 중: {editingTab?.toUpperCase()}
          </div>
          <textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            style={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: '12px',
              backgroundColor: '#1e1e1e',
              color: '#d4d4d4',
              border: '1px solid #444',
              borderRadius: '4px',
              padding: '8px',
              resize: 'none',
              outline: 'none'
            }}
            placeholder="코드를 편집하세요..."
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button
              onClick={handleSave}
              style={{
                padding: '6px 12px',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              저장
            </button>
            <button
              onClick={handleCancel}
              style={{
                padding: '6px 12px',
                backgroundColor: '#f44336',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              취소
            </button>
          </div>
        </div>
      )
    }

    // 편집 모드가 아닐 때는 마지막으로 저장된 내용이나 생성된 내용을 표시
    const displayYAML = lastSavedYAML || yaml
    const displayShell = lastSavedShell || shell

    return (
      <div style={{ height: '100%' }}>
        {tab === 'yaml' ? (
          <pre 
            style={{ 
              whiteSpace: 'pre-wrap', 
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '4px',
              backgroundColor: '#1e1e1e',
              border: '1px solid transparent',
              transition: 'border-color 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#444'
              e.currentTarget.style.backgroundColor = '#2a2a2a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'transparent'
              e.currentTarget.style.backgroundColor = '#1e1e1e'
            }}
            onClick={() => handleCodeClick(displayYAML, 'yaml')}
            title="클릭하여 편집"
          >
            {displayYAML}
          </pre>
        ) : (
          <pre 
            style={{ 
              whiteSpace: 'pre-wrap', 
              cursor: 'pointer',
              padding: '8px',
              borderRadius: '4px',
              backgroundColor: '#1e1e1e',
              border: '1px solid transparent',
              transition: 'border-color 0.2s ease'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#444'
              e.currentTarget.style.backgroundColor = '#2a2a2a'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'transparent'
              e.currentTarget.style.backgroundColor = '#1e1e1e'
            }}
            onClick={() => handleCodeClick(displayShell, 'shell')}
            title="클릭하여 편집"
          >
            {displayShell}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid rgba(255,255,255,.15)', paddingBottom: 8, marginBottom: 8 }}>
        <button onClick={() => setTab('yaml')} className={tab === 'yaml' ? 'active' : ''}>YAML</button>
        <button onClick={() => setTab('shell')} className={tab === 'shell' ? 'active' : ''}>Shell</button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {renderContent()}
      </div>
    </div>
  )
}



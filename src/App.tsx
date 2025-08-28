import { useCallback, useState } from 'react'
import './App.css'
import FlowEditor from './flow/FlowEditor'
import OutputPanel from './flow/OutputPanel'
import type { Edge, Node } from 'reactflow'
import type { PipelineNodeData } from './flow/codegen'

function App() {
  const [nodes, setNodes] = useState<Node<PipelineNodeData>[]>([])
  const [edges, setEdges] = useState<Edge[]>([])

  const handleGraphChange = useCallback((ns: Node<PipelineNodeData>[], es: Edge[]) => {
    setNodes(ns)
    setEdges(es)
  }, [])

  return (
    <div style={{ width: '100%', display: 'grid', gridTemplateColumns: '1fr 520px', gap: 16, height: '100vh', padding: 16, boxSizing: 'border-box' }}>
      <div style={{ height: '100%', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, overflow: 'hidden' }}>
        <FlowEditor onGraphChange={handleGraphChange} />
      </div>
      <div style={{ height: '100%', border: '1px solid rgba(255,255,255,.15)', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: 12, borderBottom: '1px solid rgba(255,255,255,.15)', fontWeight: 700 }}>Output</div>
        <div style={{ padding: 12, flex: 1, overflow: 'hidden' }}>
          <OutputPanel nodes={nodes} edges={edges} />
        </div>
      </div>
    </div>
  )
}

export default App

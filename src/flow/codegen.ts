import type { Edge, Node } from 'reactflow'
import { MarkerType } from 'reactflow'
import { load, Kind } from 'yaml-ast-parser'
import type { YAMLNode, YAMLScalar, YamlMap, YAMLSequence } from 'yaml-ast-parser'

/**
 * CI/CD 그래프 → 코드 생성 모듈
 * - 그래프는 React Flow의 `Node`, `Edge`로 표현
 * - 현재는 직렬(선형) 파이프라인만 지원. 병렬/분기는 추후 DAG 정렬로 확장 가능
 * - 출력: bash 스크립트와 GitHub Actions YAML
 */

/**
 * 지원하는 노드 종류. 팔레트와 코드 생성 매핑의 기준이 됨
 */
export type PipelineNodeKind =
  | 'start'
  | 'git_clone'
  | 'linux_install'
  | 'prebuild_node'
  | 'prebuild_python'
  | 'prebuild_java'
  | 'prebuild_custom'
  | 'build_npm'
  | 'build_python'
  | 'build_java'
  | 'docker_build'
  | 'run_tests'
  | 'deploy'
  | 'notify_slack'

/**
 * 노드가 보유하는 데이터. 코드 생성 시 필요한 속성들을 선택적으로 포함
 */
export interface PipelineNodeData {
  kind: PipelineNodeKind
  label?: string
  // common optional fields
  lang?: 'javascript' | 'python' | 'java'
  command?: string

  // git
  repoUrl?: string
  branch?: string

  // linux install
  osPkg?: 'apt' | 'yum' | 'apk'
  packages?: string

  // node prebuild
  manager?: 'npm' | 'yarn' | 'pnpm'

  // prebuild custom
  script?: string

  // docker
  dockerfile?: string
  tag?: string

  // tests
  testType?: 'unit' | 'integration' | 'e2e'

  // deploy
  environment?: 'staging' | 'production' | 'development'
  deployScript?: string

  // notify
  channel?: string
  message?: string
}

/** React Flow Node with our domain data */
export type PipelineNode = Node<PipelineNodeData>

/**
 * 사용자가 입력한 문자열에서 양끝 따옴표를 제거
 * - YAML/쉘 라인에 그대로 삽입되므로, 중복 인용을 방지
 */
const dequote = (t: string | undefined): string => {
  if (!t) return ''
  const s = t.trim()
  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"')) || (s.startsWith('`') && s.endsWith('`'))) {
    return s.substring(1, s.length - 1)
  }
  return s
}

/**
 * 언어별 기본 준비 스크립트 (선택)
 */
const languageSetup = (lang: string | undefined): string => {
  switch (lang) {
    case 'python':
      return '# Setup Python\npython3 --version || true\npip3 install -r requirements.txt || true\n'
    case 'java':
      return "# Setup Java\njava -version || true\nmvn -v || true\n"
    case 'javascript':
    default:
      return '# Setup Node.js\nnode -v || true\nnpm ci || npm install\n'
  }
}

/**
 * 임의 커맨드를 언어 주석과 함께 감싸는 유틸리티
 */
const commandPrefix = (lang: string | undefined, cmd: string): string => {
  return `# ${lang || 'generic'} command\n${cmd}\n`
}

/**
 * 노드 → bash 스니펫 변환기
 * - 각 kind에 대응하는 스크립트를 반환
 */
function nodeToScript(n: PipelineNodeData): string {
  switch (n.kind) {
    case 'start':
      return '#!/bin/bash\n# CI/CD Pipeline\necho "🚀 Starting pipeline..."\n'
    case 'git_clone':
      return `git clone -b ${dequote(n.branch)} ${dequote(n.repoUrl)}\n`
    case 'linux_install': {
      const pkgs = dequote(n.packages)
      if (n.osPkg === 'yum') return `sudo yum install -y ${pkgs}\n`
      if (n.osPkg === 'apk') return `sudo apk add --no-cache ${pkgs}\n`
      return `sudo apt-get update && sudo apt-get install -y ${pkgs}\n`
    }
    case 'prebuild_node': {
      if (n.manager === 'yarn') return '# Prebuild Node (yarn)\nyarn install --frozen-lockfile || yarn install\n'
      if (n.manager === 'pnpm') return '# Prebuild Node (pnpm)\npnpm install --frozen-lockfile || pnpm install\n'
      return '# Prebuild Node (npm)\nnpm ci || npm install\n'
    }
    case 'prebuild_python':
      return '# Prebuild Python\npython3 -m venv .venv || true\n. .venv/bin/activate || true\npip install -r requirements.txt || true\n'
    case 'prebuild_java':
      return '# Prebuild Java\n# Assuming Gradle Wrapper or Maven present\nchmod +x gradlew || true\n'
    case 'prebuild_custom':
      return `# Prebuild custom\n${dequote(n.script)}\n`
    case 'build_npm':
      return '# Build NPM\nnpm run build\n'
    case 'build_python':
      return '# Build Python\npython setup.py build || true\n'
    case 'build_java':
      return '# Build Java\nif [ -f gradlew ]; then\n  ./gradlew build\nelse\n  mvn -B package --file pom.xml\nfi\n'
    case 'docker_build':
      return `docker build -f ${dequote(n.dockerfile)} -t ${dequote(n.tag)} .\n`
    case 'run_tests':
      return `# Run ${n.testType || ''} tests\n${dequote(n.command)}\n`
    case 'deploy':
      return `# Deploy to ${n.environment || ''}\n${dequote(n.deployScript)}\n`
    case 'notify_slack': {
      const payload = JSON.stringify({ channel: n.channel || '', text: n.message || '' })
      return `# Send Slack notification\ncurl -X POST -H 'Content-type: application/json' --data '${payload}' $SLACK_WEBHOOK\n`
    }
    default: {
      const setup = languageSetup(n.lang)
      const cmd = commandPrefix(n.lang, dequote(n.command || ''))
      return `${setup}${cmd}`
    }
  }
}

/**
 * 간단한 선형 정렬
 * - 규칙: `start`에서 시작하여 아웃고잉이 정확히 1개인 간선을 따라가며 정렬
 * - 분기/병렬 발생 시 탐색 중단 (현 버전 제한)
 */
export function linearize(nodes: PipelineNode[], edges: Edge[]): PipelineNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const outgoing = new Map<string, string[]>()
  edges.forEach(e => {
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source)!.push(e.target)
  })

  const start = nodes.find(n => n.data.kind === 'start')
  if (!start) return []

  const ordered: PipelineNode[] = []
  const visited = new Set<string>()
  let cursor: PipelineNode | undefined = start
  while (cursor && !visited.has(cursor.id)) {
    ordered.push(cursor)
    visited.add(cursor.id)
    const nextIds = (outgoing.get(cursor.id) || [])
    if (nextIds.length !== 1) break
    const next = byId.get(nextIds[0])
    if (!next) break
    cursor = next
  }
  return ordered
}

/**
 * 정렬된 노드 시퀀스를 bash 스크립트로 병합
 */
export function generateShell(nodes: PipelineNode[], edges: Edge[]): string {
  const ordered = linearize(nodes, edges)
  if (ordered.length === 0) return '# Add a Start node and connect stages to generate script.'
  return ordered.map(n => nodeToScript(n.data)).join('')
}

/**
 * GitHub Actions YAML 생성
 * - 사용된 언어에 맞춰 setup 액션을 자동 추가
 * - 최종 run에는 `generateShell` 결과를 들여쓰기하여 삽입
 */
export function generateYAML(nodes: PipelineNode[], edges: Edge[]): string {
  const ordered = linearize(nodes, edges)
  if (ordered.length === 0) return '# Add a Start node and connect stages to generate YAML.'

  const used = new Set<string>()
  ordered.forEach(n => {
    const k = n.data.kind
    if (k.includes('node') || k.includes('npm') || n.data.lang === 'javascript') used.add('javascript')
    if (k.includes('python') || n.data.lang === 'python') used.add('python')
    if (k.includes('java') || n.data.lang === 'java') used.add('java')
  })

  const setup: string[] = []
  if (used.has('javascript')) setup.push("      - name: Setup Node.js\n        uses: actions/setup-node@v3\n        with:\n          node-version: '18'")
  if (used.has('python')) setup.push("      - name: Setup Python\n        uses: actions/setup-python@v4\n        with:\n          python-version: '3.x'")
  if (used.has('java')) setup.push("      - name: Setup Java\n        uses: actions/setup-java@v3\n        with:\n          distribution: 'temurin'\n          java-version: '17'")

  // bash 스크립트를 생성해 YAML run 블록에 삽입
  const script = generateShell(nodes, edges)
  const indented = script.split('\n').map(l => (l ? '          ' + l : '')).join('\n')

  return `# Generated CI/CD Pipeline\nname: ReactFlow CI/CD Pipeline\non: [push, pull_request]\njobs:\n  pipeline:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Checkout code\n        uses: actions/checkout@v3\n${setup.join('\n')}\n      - name: Execute Pipeline\n        shell: bash\n        run: |\n${indented}`
}

/**
 * YAML 문자열을 AST로 파싱하여 노드와 엣지로 변환
 */
export function parseYAMLToGraph(yamlContent: string): { nodes: Node<PipelineNodeData>[], edges: Edge[] } {
  try {
    console.log('=== YAML 파싱 시작 ===')
    console.log('입력 YAML:', yamlContent)
    
    // yaml-ast-parser를 사용하여 YAML을 AST로 파싱
    const ast = load(yamlContent)
    console.log('생성된 AST:', ast)
    
    const nodes: Node<PipelineNodeData>[] = []
    const edges: Edge[] = []
    
    // AST에서 steps 섹션 찾기
    const steps = findStepsInAST(ast)
    console.log('찾은 steps 섹션:', steps)
    
    if (steps && steps.kind === Kind.SEQ) {
      const stepsSequence = steps as YAMLSequence
      console.log(`steps 시퀀스 발견: ${stepsSequence.items.length}개 항목`)
      
      stepsSequence.items.forEach((step, index) => {
        console.log(`Step 처리 중:`, step)
        
        if (step.kind === Kind.MAP) {
          const stepMap = step as YamlMap
          const stepData = parseStepFromAST(stepMap)
          
          if (stepData) {
            console.log(`Step ${index} 파싱 완료:`, stepData)
            
            const nodeData = createNodeDataFromGitHubAction(stepData)
            if (nodeData) {
              console.log(`Step ${index} 노드 데이터 생성:`, nodeData)
              
              const node: Node<PipelineNodeData> = {
                id: `step-${index}`,
                position: { x: 100, y: 100 + index * 150 },
                data: nodeData,
                type: 'default'
              }
              nodes.push(node)
              
              // 이전 노드와 연결
              if (index > 0) {
                const edge: Edge = {
                  id: `edge-${index - 1}`,
                  source: nodes[index - 1].id,
                  target: node.id,
                  type: 'smoothstep',
                  animated: true,
                  markerEnd: { 
                    type: MarkerType.ArrowClosed,
                    width: 20,
                    height: 20
                  },
                  label: `${index}`,
                  labelStyle: {
                    fill: '#fff',
                    fontWeight: 600,
                    fontSize: '12px'
                  },
                  labelBgStyle: {
                    fill: '#1a192b',
                    fillOpacity: 0.8
                  },
                  labelBgPadding: [4, 4],
                  labelBgBorderRadius: 4
                }
                edges.push(edge)
              }
            } else {
              console.warn(`Step ${index}에서 노드 데이터 생성 실패`)
            }
          } else {
            console.warn(`Step ${index} 파싱 실패`)
          }
        } else {
          console.warn(`Step ${index}가 MAP이 아님:`, step.kind)
        }
      })
    } else {
      console.warn('steps 섹션을 찾을 수 없거나 시퀀스가 아님:', steps)
    }
    
    console.log('=== 최종 결과 ===')
    console.log('생성된 노드:', nodes)
    console.log('생성된 엣지:', edges)
    
    return { nodes, edges }
  } catch (error) {
    console.error('YAML AST 파싱 오류:', error)
    console.error('오류 스택:', error instanceof Error ? error.stack : '알 수 없는 오류')
    return { nodes: [], edges: [] }
  }
}

/**
 * YAML 문자열을 직접 파싱하여 Shell 코드 생성
 * - parseYAMLToGraph와 유사하지만 Shell 코드만 반환
 */
export function generateShellFromYAML(yamlContent: string): string {
  try {
    console.log('=== YAML에서 Shell 생성 시작 ===')
    
    // yaml-ast-parser를 사용하여 YAML을 AST로 파싱
    const ast = load(yamlContent)
    
    // AST에서 steps 섹션 찾기
    const steps = findStepsInAST(ast)
    
    if (steps && steps.kind === Kind.SEQ) {
      const stepsSequence = steps as YAMLSequence
      console.log(`Shell 생성: ${stepsSequence.items.length}개 step 발견`)
      
      // 각 step을 Shell 명령어로 변환
      const shellCommands: string[] = []
      
      stepsSequence.items.forEach((step) => {
        if (step.kind === Kind.MAP) {
          const stepMap = step as YamlMap
          const stepData = parseStepFromAST(stepMap)
          
          if (stepData) {
            const shellCommand = convertStepToShell(stepData)
            if (shellCommand) {
              shellCommands.push(shellCommand)
            }
          }
        }
      })
      
      if (shellCommands.length > 0) {
        const result = shellCommands.join('\n\n')
        console.log('=== Shell 생성 완료 ===')
        return result
      }
    }
    
    return '# YAML에서 Shell을 생성할 수 없습니다.'
  } catch (error) {
    console.error('YAML에서 Shell 생성 중 오류:', error)
    return '# YAML 파싱 오류로 Shell을 생성할 수 없습니다.'
  }
}

/**
 * GitHub Actions step을 Shell 명령어로 변환
 */
function convertStepToShell(stepData: Record<string, string>): string | null {
  const { name, uses, run, shell } = stepData
  
  // uses 기반 step 처리
  if (uses) {
    if (uses.includes('checkout')) {
      return `# ${name}\necho "📥 Checking out code..."\ngit clone ${stepData.repoUrl || 'https://github.com/user/repo.git'} .\ngit checkout ${stepData.branch || 'main'}`
    } else if (uses.includes('setup-java')) {
      return `# ${name}\necho "☕ Setting up Java..."\njava -version\nexport JAVA_HOME=/usr/lib/jvm/temurin-17-jdk\nexport PATH=$JAVA_HOME/bin:$PATH`
    } else if (uses.includes('setup-node')) {
      return `# ${name}\necho "🟢 Setting up Node.js..."\nnode --version\nnpm --version`
    } else if (uses.includes('setup-python')) {
      return `# ${name}\necho "🐍 Setting up Python..."\npython3 --version\nnpm --version`
    }
  }
  
  // run 기반 step 처리
  if (run) {
    return `# ${name}\necho "🚀 Executing: ${name}"\n${run}`
  }
  
  // shell 기반 step 처리
  if (shell) {
    return `# ${name}\necho "💻 Executing with ${shell}..."\n# ${name} 실행`
  }
  
  // 기본 fallback
  return `# ${name}\necho "⚡ Executing step: ${name}"\n# ${name} 단계 실행`
}

/**
 * AST에서 steps 섹션을 찾는 함수
 */
function findStepsInAST(ast: YAMLNode): YAMLNode | null {
  console.log('findStepsInAST 시작, AST 종류:', ast.kind)
  
  if (ast.kind === Kind.MAP) {
    const astMap = ast as YamlMap
    console.log('AST가 MAP임, mappings 개수:', astMap.mappings.length)
    
    for (const mapping of astMap.mappings) {
      if (mapping.key.kind === Kind.SCALAR) {
        const key = (mapping.key as YAMLScalar).value
        console.log('매핑 키 발견:', key)
        
        if (key === 'jobs') {
          console.log('jobs 섹션 발견')
          // jobs 섹션에서 pipeline 찾기
          if (mapping.value.kind === Kind.MAP) {
            const jobsMap = mapping.value as YamlMap
            console.log('jobs가 MAP임, mappings 개수:', jobsMap.mappings.length)
            
            for (const jobMapping of jobsMap.mappings) {
              if (jobMapping.key.kind === Kind.SCALAR) {
                const jobKey = (jobMapping.key as YAMLScalar).value
                console.log('job 키 발견:', jobKey)
                
                if (jobKey === 'pipeline') {
                  console.log('pipeline 섹션 발견')
                  // pipeline 섹션에서 steps 찾기
                  if (jobMapping.value.kind === Kind.MAP) {
                    const pipelineMap = jobMapping.value as YamlMap
                    console.log('pipeline이 MAP임, mappings 개수:', pipelineMap.mappings.length)
                    
                    for (const pipelineMapping of pipelineMap.mappings) {
                      if (pipelineMapping.key.kind === Kind.SCALAR) {
                        const pipelineKey = (pipelineMapping.key as YAMLScalar).value
                        console.log('pipeline 키 발견:', pipelineKey)
                        
                        if (pipelineKey === 'steps') {
                          console.log('steps 섹션 발견!')
                          return pipelineMapping.value
                        }
                      }
                    }
                  } else {
                    console.log('pipeline이 MAP이 아님:', jobMapping.value.kind)
                  }
                }
              } else {
                console.log('job 키가 SCALAR가 아님:', jobMapping.key.kind)
              }
            }
          } else {
            console.log('jobs가 MAP이 아님:', mapping.value.kind)
          }
        }
      } else {
        console.log('매핑 키가 SCALAR가 아님:', mapping.key.kind)
      }
    }
  } else {
    console.log('AST가 MAP이 아님:', ast.kind)
  }
  
  console.log('steps 섹션을 찾을 수 없음')
  return null
}

/**
 * AST에서 step 데이터를 추출하는 함수
 */
function parseStepFromAST(stepMap: YamlMap): Record<string, string> | null {
  console.log('parseStepFromAST 시작, stepMap mappings 개수:', stepMap.mappings.length)
  
  const stepData: Record<string, string> = {}
  
  // 모든 매핑을 먼저 확인
  const allMappings = stepMap.mappings.map(m => ({
    key: m.key.kind === Kind.SCALAR ? (m.key as YAMLScalar).value : `[${m.key.kind}]`,
    valueKind: m.value.kind,
    value: m.value.kind === Kind.SCALAR ? (m.value as YAMLScalar).value : `[${m.value.kind}]`
  }))
  console.log('Step의 모든 매핑들:', allMappings)
  
  for (const mapping of stepMap.mappings) {
    console.log('매핑 처리 중:', mapping.key.kind, mapping.value.kind)
    
    if (mapping.key.kind === Kind.SCALAR && mapping.value.kind === Kind.SCALAR) {
      const key = (mapping.key as YAMLScalar).value
      const value = (mapping.value as YAMLScalar).value
      
      console.log('스칼라 키-값 쌍 발견:', key, '=', value)
      stepData[key] = value
    } else if (mapping.key.kind === Kind.SCALAR && mapping.value.kind === Kind.MAP) {
      // with 섹션과 같은 중첩된 맵 처리
      const key = (mapping.key as YAMLScalar).value
      const nestedMap = mapping.value as YamlMap
      
      console.log('중첩된 맵 발견:', key, 'mappings 개수:', nestedMap.mappings.length)
      
      if (key === 'with') {
        // with 내부의 모든 매핑 확인
        const withMappings = nestedMap.mappings.map(m => ({
          key: m.key.kind === Kind.SCALAR ? (m.key as YAMLScalar).value : `[${m.key.kind}]`,
          valueKind: m.value.kind,
          value: m.value.kind === Kind.SCALAR ? (m.value as YAMLScalar).value : `[${m.value.kind}]`
        }))
        console.log('with 내부의 모든 매핑들:', withMappings)
        
        for (const nestedMapping of nestedMap.mappings) {
          if (nestedMapping.key.kind === Kind.SCALAR && nestedMapping.value.kind === Kind.SCALAR) {
            const nestedKey = (nestedMapping.key as YAMLScalar).value
            const nestedValue = (nestedMapping.value as YAMLScalar).value
            
            console.log('with 내부 키-값 쌍 발견:', nestedKey, '=', nestedValue)
            stepData[nestedKey] = nestedValue
          }
        }
      }
    }
  }
  
  console.log('최종 stepData:', stepData)
  console.log('stepData 키들:', Object.keys(stepData))
  return Object.keys(stepData).length > 0 ? stepData : null
}

/**
 * GitHub Actions step을 노드 데이터로 변환
 */
function createNodeDataFromGitHubAction(step: Record<string, string>): PipelineNodeData | null {
  const name = step.name || 'Unknown Step'
  const uses = step.uses || ''

  let kind: PipelineNodeData['kind'] = 'prebuild_custom'
  const label = name
  const additionalData: Record<string, string> = {}

  if (uses.includes('actions/setup-node')) {
    kind = 'prebuild_node'
    additionalData.manager = 'npm'
  } else if (uses.includes('actions/setup-python')) {
    kind = 'prebuild_python'
    additionalData.lang = 'python'
  } else if (uses.includes('actions/setup-java')) {
    kind = 'prebuild_java'
    additionalData.lang = 'java'
    if (step['java-version']) {
      additionalData.javaVersion = step['java-version']
    }
    if (step.distribution) {
      additionalData.distribution = step.distribution
    }
  } else if (uses.includes('actions/checkout')) {
    kind = 'git_clone'
    additionalData.repoUrl = 'https://github.com/user/repo.git'
    additionalData.branch = 'main'
  } else if (uses.includes('actions/setup-apt') || uses.includes('actions/setup-yum') || uses.includes('actions/setup-apk')) {
    kind = 'linux_install'
    additionalData.osPkg = 'apt'
    if (step.packages) {
      additionalData.packages = step.packages
    }
  } else if (uses.includes('actions/setup-npm') || uses.includes('actions/setup-yarn') || uses.includes('actions/setup-pnpm')) {
    kind = 'prebuild_node'
    additionalData.manager = 'npm'
  } else if (uses.includes('actions/setup-pip')) {
    kind = 'prebuild_python'
    additionalData.lang = 'python'
  } else if (uses.includes('actions/setup-maven') || uses.includes('actions/setup-gradle')) {
    kind = 'prebuild_java'
    additionalData.lang = 'java'
  } else if (uses.includes('actions/setup-custom')) {
    kind = 'prebuild_custom'
    if (step.script) {
      additionalData.script = step.script
    }
  }

  // shell과 run 속성도 확인
  if (step.shell) {
    if (step.shell.includes('bash')) {
      kind = 'run_tests'
      additionalData.testType = 'unit'
      additionalData.command = step.shell
    }
  }

  if (step.run) {
    if (step.run.includes('npm ci') || step.run.includes('npm install')) {
      kind = 'prebuild_node'
      additionalData.manager = 'npm'
    } else if (step.run.includes('mvn') || step.run.includes('gradle')) {
      kind = 'build_java'
    } else if (step.run.includes('pip install')) {
      kind = 'prebuild_python'
    }
  }

  return {
    kind,
    label,
    ...additionalData
  }
}

/**
 * Shell 코드를 파싱하여 그래프로 변환
 */
export function parseShellToGraph(shellContent: string): { nodes: Node<PipelineNodeData>[], edges: Edge[] } {
  try {
    console.log('=== Shell에서 그래프 생성 시작 ===')
    const lines = shellContent.split('\n').filter(line => line.trim())
    const nodes: Node<PipelineNodeData>[] = []
    const edges: Edge[] = []
    
    let nodeIndex = 0
    
    lines.forEach((line) => {
      const trimmedLine = line.trim()
      
      // 주석으로 시작하는 라인을 노드로 변환
      if (trimmedLine.startsWith('#') && trimmedLine.length > 1) {
        const comment = trimmedLine.substring(1).trim()
        
        // 특정 패턴에 따른 노드 타입 결정
        let nodeKind: PipelineNodeKind = 'prebuild_custom'
        let nodeLabel = comment
        
        if (comment.includes('Checkout') || comment.includes('checkout')) {
          nodeKind = 'git_clone'
          nodeLabel = 'Checkout Code'
        } else if (comment.includes('Setup Java') || comment.includes('Java')) {
          nodeKind = 'prebuild_java'
          nodeLabel = 'Setup Java'
        } else if (comment.includes('Setup Python')) {
          nodeKind = 'prebuild_python'
          nodeLabel = 'Setup Python'
        } else if (comment.includes('Setup Node')) {
          nodeKind = 'prebuild_node'
          nodeLabel = 'Setup Node.js'
        } else if (comment.includes('Build') || comment.includes('build')) {
          nodeKind = 'build_npm'
          nodeLabel = comment
        } else if (comment.includes('Test') || comment.includes('test')) {
          nodeKind = 'run_tests'
          nodeLabel = comment
        } else if (comment.includes('Deploy') || comment.includes('deploy')) {
          nodeKind = 'deploy'
          nodeLabel = comment
        } else if (comment.includes('Execute') || comment.includes('Pipeline')) {
          nodeKind = 'prebuild_custom'
          nodeLabel = comment
        }
        
        const nodeData: PipelineNodeData = {
          kind: nodeKind,
          label: nodeLabel,
          command: comment
        }
        
        const node: Node<PipelineNodeData> = {
          id: `shell-step-${nodeIndex}`,
          position: { x: 100, y: 100 + nodeIndex * 150 },
          data: nodeData,
          type: 'default'
        }
        
        nodes.push(node)
        
        // 이전 노드와 연결
        if (nodeIndex > 0) {
          const edge: Edge = {
            id: `shell-edge-${nodeIndex - 1}-${nodeIndex}`,
            source: `shell-step-${nodeIndex - 1}`,
            target: `shell-step-${nodeIndex}`,
            type: 'smoothstep',
            animated: true,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 20,
              height: 20
            },
            label: `${nodeIndex}`,
            labelStyle: {
              fill: '#fff',
              fontWeight: 600,
              fontSize: '12px'
            },
            labelBgStyle: {
              fill: '#1a192b',
              fillOpacity: 0.8
            },
            labelBgPadding: [4, 4],
            labelBgBorderRadius: 4
          }
          edges.push(edge)
        }
        
        nodeIndex++
      }
    })
    
    console.log('Shell 파싱 결과:', { nodes, edges })
    return { nodes, edges }
    
  } catch (error) {
    console.error('Shell 파싱 중 오류:', error)
    return { nodes: [], edges: [] }
  }
}

/**
 * Shell 코드를 파싱하여 YAML 생성
 */
export function generateYAMLFromShell(shellContent: string): string {
  try {
    console.log('=== Shell에서 YAML 생성 시작 ===')
    const lines = shellContent.split('\n').filter(line => line.trim())
    const steps: Record<string, unknown>[] = []
    
    lines.forEach((line) => {
      const trimmedLine = line.trim()
      
      // 주석으로 시작하는 라인을 step으로 변환
      if (trimmedLine.startsWith('#') && trimmedLine.length > 1) {
        const comment = trimmedLine.substring(1).trim()
        
        // 특정 패턴에 따른 step 생성
        const step: Record<string, unknown> = { name: comment }
        
        if (comment.includes('Checkout') || comment.includes('checkout')) {
          step.uses = 'actions/checkout@v3'
        } else if (comment.includes('Setup Java') || comment.includes('Java')) {
          step.uses = 'actions/setup-java@v3'
          step.with = {
            distribution: 'temurin',
            'java-version': '17'
          }
        } else if (comment.includes('Setup Python')) {
          step.uses = 'actions/setup-python@v4'
          step.with = {
            'python-version': '3.9'
          }
        } else if (comment.includes('Setup Node')) {
          step.uses = 'actions/setup-node@v3'
          step.with = {
            'node-version': '18'
          }
        } else if (comment.includes('Build') || comment.includes('build')) {
          step.run = `# ${comment}\necho "Building..."`
        } else if (comment.includes('Test') || comment.includes('test')) {
          step.run = `# ${comment}\necho "Running tests..."`
        } else if (comment.includes('Deploy') || comment.includes('deploy')) {
          step.run = `# ${comment}\necho "Deploying..."`
        } else if (comment.includes('Execute') || comment.includes('Pipeline')) {
          step.shell = 'bash'
          step.run = `#!/bin/bash\necho "🚀 Starting pipeline..."\nchmod +x gradlew || true`
        } else {
          // 기본적으로 run으로 처리
          step.run = `# ${comment}\necho "Executing: ${comment}"`
        }
        
        steps.push(step)
      }
    })
    
    if (steps.length > 0) {
      const yaml = {
        name: 'Generated CI/CD Pipeline',
        on: ['push', 'pull_request'],
        jobs: {
          pipeline: {
            'runs-on': 'ubuntu-latest',
            steps: steps
          }
        }
      }
      
      console.log('=== Shell에서 YAML 생성 완료 ===')
      return JSON.stringify(yaml, null, 2)
    }
    
    return '# Shell에서 YAML을 생성할 수 없습니다.'
  } catch (error) {
    console.error('Shell에서 YAML 생성 중 오류:', error)
    return '# Shell 파싱 오류로 YAML을 생성할 수 없습니다.'
  }
}



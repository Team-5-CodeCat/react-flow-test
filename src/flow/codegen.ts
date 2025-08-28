import type { Edge, Node } from 'reactflow'

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



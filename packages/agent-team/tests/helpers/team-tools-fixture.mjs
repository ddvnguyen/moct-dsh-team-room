// Real module behind the member-tool-policy spec's preset row.
//
// rc.1 preset health resolves every row from disk, so the spec's composition
// points here with a file: URL. This file lives beside the spec, where its
// package imports resolve through the repository's node_modules.
import { apply as applyAgentTeamTools } from '@ddvnguyen/moct-dsh-team-room/tools'
import { defineTool } from '@deepseek-ai/dsh-tools'

// dsh 0.2.2 dropped defineContentToolFixture: a fixture is an ordinary tool whose
// output schema carries the text and whose renderer shows it.
const textTool = (name, description, text) => defineTool({
  name,
  description,
  parameters: {},
  output: {
    schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
    render: (_args, value) => [{ type: 'text', text: value.text }],
  },
  execute: async () => ({ text }),
})

export const name = 'test-team-tools'
export const inject = ['tools']

export function apply(scope) {
  applyAgentTeamTools(scope)
  scope.tools.register(textTool('ordinary_tool', 'ordinary', 'ordinary ok'))
  scope.tools.register(textTool('spare_tool', 'spare', 'spare ok'))
}

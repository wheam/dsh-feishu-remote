import { beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => ({
  tenantTokenInternal: vi.fn(),
  applicationGet: vi.fn(),
}))

vi.mock('@larksuiteoapi/node-sdk', async importOriginal => {
  const actual = await importOriginal<typeof import('@larksuiteoapi/node-sdk')>()
  return {
    ...actual,
    Client: class {
      auth = {
        v3: {
          tenantAccessToken: {
            internal: sdk.tenantTokenInternal,
          },
        },
      }

      application = {
        v6: {
          application: {
            get: sdk.applicationGet,
          },
        },
      }
    },
  }
})

import { probePersonalAgent } from '../src/onboarding.js'

describe('PersonalAgent credential probe', () => {
  beforeEach(() => {
    sdk.tenantTokenInternal.mockReset()
    sdk.applicationGet.mockReset()
    sdk.applicationGet.mockResolvedValue({
      code: 0,
      data: {
        app: {
          app_name: 'DSH Remote · Tester',
          owner: { owner_id: 'ou_owner' },
        },
      },
    })
  })

  it('accepts the top-level tenant token returned by the live Feishu endpoint', async () => {
    sdk.tenantTokenInternal.mockResolvedValue({
      code: 0,
      msg: 'success',
      tenant_access_token: 't-runtime-shape',
      expire: 7_200,
    })

    await expect(probePersonalAgent('cli_test', 'secret', 'feishu')).resolves.toMatchObject({
      ownerOpenId: 'ou_owner',
      appName: 'DSH Remote · Tester',
    })
  })

  it('continues to accept the generated SDK nested token envelope', async () => {
    sdk.tenantTokenInternal.mockResolvedValue({
      code: 0,
      msg: 'success',
      data: { tenant_access_token: 't-generated-type-shape', expire: 7_200 },
    })

    await expect(probePersonalAgent('cli_test', 'secret', 'feishu')).resolves.toMatchObject({
      ownerOpenId: 'ou_owner',
    })
  })

  it('still rejects a successful-looking response without a token', async () => {
    sdk.tenantTokenInternal.mockResolvedValue({ code: 0, msg: 'success' })

    await expect(probePersonalAgent('cli_test', 'secret', 'feishu')).rejects.toThrow(
      '飞书没有接受新应用凭据',
    )
    expect(sdk.applicationGet).not.toHaveBeenCalled()
  })
})

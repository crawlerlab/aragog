import { checkTaskInput as clientCheck } from '../client/src/utils'
import { checkTaskInput as serverCheck } from '../src/utils'

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
const getClientInput = (data: any = {}): any => {
  return {
    id: 'id',
    url: 'url',
    script: 'script',
    disableImage: true,
    encoding: 'encoding',
    method: 'GET',
    auth: {
      username: 'username',
      password: 'password',
    },
    data: { a: '1' },
    params: { a: '1' },
    headers: { a: '1' },
    cookies: [{ name: 'name', value: 'value' }],
    requireHeaders: ['header'],
    timeout: 1000,
    ...data,
  }
}

describe.each([
  ['客户端参数校验', 'client', clientCheck],
  ['服务端参数校验', 'server', serverCheck],
])('%s', (testName, type, inputCheck) => {
  test.each([
    getClientInput(),
    getClientInput({ method: 'GET' }),
    getClientInput({ method: 'POST' }),
    getClientInput({ data: { a: '1', b: '2' } }),
    getClientInput({ data: 'post data' }),
    getClientInput({ requireHeaders: true }),
    getClientInput({ requireHeaders: ['header1', 'header2'] }),
    getClientInput({
      cookies: [
        {
          name: 'name',
          value: 'value',
          domain: 'domain',
          path: 'path',
          expires: Date.now(),
          httpOnly: true,
          secure: true,
          sameSite: 'Strict',
        },
      ],
    }),
  ])('通过类型校验-%#', (data) => {
    expect(() => {
      inputCheck(data)
    }).not.toThrow()
  })

  const notPassTestSuite = [
    [getClientInput({ url: '' }), 'url is required'],
    [getClientInput({ script: '' }), 'script is required'],
    [getClientInput({ url: 123 }), 'url must be of type string'],
    [getClientInput({ script: 123 }), 'script must be of type string'],
    [getClientInput({ method: 'DELETE' }), 'method should be GET or POST'],
    [getClientInput({ disableImage: 'disable' }), 'disableImage must be of type boolean'],
    [getClientInput({ encoding: 123 }), 'encoding must be of type string'],
    [
      getClientInput({ auth: { username: 'user', password: 123456 } }),
      'auth should contain username and password of string type',
    ],
    [
      getClientInput({ auth: { username: 12345, password: 'pass' } }),
      'auth should contain username and password of string type',
    ],
    [getClientInput({ data: 123 }), 'data must be of type object or string'],
    [getClientInput({ params: 123 }), 'params must be of type object'],
    [getClientInput({ headers: 123 }), 'headers must be of type object'],
    [getClientInput({ requireHeaders: 123 }), 'requireHeaders must be of type boolean or array'],
    [getClientInput({ timeout: '123' }), 'timeout must be of type number'],
    [getClientInput({ cookies: '123' }), 'cookies must be of type array'],
    [getClientInput({ cookies: [{ name: 'name' }] }), 'cookies.name and cookies.value is required'],
    [
      getClientInput({ cookies: [{ value: 'value' }] }),
      'cookies.name and cookies.value is required',
    ],
    [
      getClientInput({ cookies: [{ name: 'name', value: 'value', expires: 'expires' }] }),
      'cookies.expires must be of type number',
    ],
    [
      getClientInput({
        cookies: [
          { name: 'name', value: 'value' },
          { name: 'name', value: 'value', httpOnly: 'ok' },
        ],
      }),
      'cookies.httpOnly must be of type boolean',
    ],
  ]
  if (type === 'client') {
    notPassTestSuite.push(
      [getClientInput({ id: '' }), 'id is required'],
      [getClientInput({ id: 123 }), 'id must be of type string']
    )
  }
  test.each(notPassTestSuite)('不通过类型校验-%#', (data, error) => {
    expect(() => {
      inputCheck(data)
    }).toThrow(error)
  })
})

import AmqpClient from '../client/src/amqp'
import {
  createConnection,
  createClient,
  createServer,
  getConnPair,
  managementApi,
  getRandomClientData,
  getRandomServerData,
  getRandomID,
} from './utils/amqp'
import { Config } from '../src/config'

jest.mock('../src/config', () => {
  const { default: actualConfig, ...otherExports } =
    jest.requireActual<{ default: Config }>('../src/config')
  const cfg: Partial<Config> = {
    ...actualConfig,
    amqp: {
      ...actualConfig.amqp,
      messageTimeout: 1,
    },
  }
  return {
    __esModule: true,
    default: cfg,
    ...otherExports,
  }
})

const wait = (time: number): Promise<void> => new Promise((r) => setTimeout(r, time))

describe('AMQP', () => {
  it('未初始化错误', async () => {
    const queue = getRandomID()
    const exchange = getRandomID()
    const sendData = getRandomClientData()
    const conn = await createConnection()
    const client = new AmqpClient(conn, {
      app: 'test',
      queue,
      exchange,
    })

    expect(() => {
      client.on('data', () => {})
    }).toThrow('uninitialized')
    await expect(
      client.sendToQueue({
        id: 'test-id',
        ...sendData,
      })
    ).rejects.toThrow('uninitialized')
  })

  it('接收数据错误', async () => {
    const { client, server, dispose } = await getConnPair()

    const clientMock = jest.fn()
    const clientErrMock = jest.fn()
    const serverMock = jest.fn()
    const serverErrMock = jest.fn()

    client.on('data', clientMock)
    client.on('error', clientErrMock)
    const sendData = getRandomClientData()
    await client.sendToQueue({
      id: 'test-id',
      ...sendData,
    })

    serverMock.mockResolvedValue('value')
    server.onData(serverMock, serverErrMock)

    await wait(100)

    expect(clientMock).not.toBeCalled()
    expect(clientErrMock).toBeCalledWith(new Error('cannot parse result'))

    await dispose()
  })

  it('数据持久化', async () => {
    const queue = getRandomID()
    const exchange = getRandomID()
    const sendData = getRandomClientData()
    const respData = getRandomServerData()
    const clientMock = jest.fn()
    const serverMock = jest.fn().mockResolvedValue(respData)

    const clientConn1 = await createConnection()
    const client1 = await createClient(clientConn1, { queue, exchange }, { durable: true })
    await client1.sendToQueue({
      id: 'test-id',
      ...sendData,
    })
    await wait(100)
    await clientConn1.close()

    const serverConn = await createConnection()
    const server = await createServer(serverConn, { queue, exchange })
    server.onData(serverMock, () => {})
    await wait(100)
    await serverConn.close()

    const clientConn2 = await createConnection()
    const client2 = await createClient(clientConn2, { queue, exchange }, { durable: true })
    client2.on('data', clientMock)
    await wait(100)
    await clientConn2.close()

    await managementApi.deleteQueue(queue)
    await managementApi.deleteExchange(exchange)

    expect(serverMock).toBeCalledWith({
      taskId: 'test-id',
      ...sendData,
    })
    expect(clientMock).toBeCalledWith({
      id: 'test-id',
      ...respData,
    })
  })

  it('基本通信', async () => {
    const { client, server, dispose } = await getConnPair()

    const clientMock = jest.fn()
    const serverMock = jest.fn()
    const serverErrMock = jest.fn()

    client.on('data', clientMock)
    const sendData = getRandomClientData()
    await client.sendToQueue({
      id: 'test-id',
      ...sendData,
    })

    const serverResp = getRandomServerData()
    serverMock.mockResolvedValue(serverResp)
    server.onData(serverMock, serverErrMock)

    await wait(100)

    expect(clientMock).toBeCalledWith({
      id: 'test-id',
      ...serverResp,
    })
    expect(serverMock).toBeCalledWith({
      taskId: 'test-id',
      ...sendData,
    })
    expect(serverErrMock).not.toHaveBeenCalled()

    await dispose()
  })

  it('优先级队列', async () => {
    const queue = getRandomID()
    const exchange = getRandomID()
    const clientConn = await createConnection()
    const client = await createClient(clientConn, { queue, exchange })
    /* eslint-disable no-restricted-syntax, no-await-in-loop */
    for (const i of [5, 7, 2, 8, 3, 9, 1, 4, 6]) {
      const sendData = getRandomClientData({ url: i.toString() })
      await client.sendToQueue({
        id: i.toString(),
        priority: i,
        ...sendData,
      })
    }
    await wait(100)
    await clientConn.close()

    const serverConn = await createConnection()
    const server = await createServer(serverConn, { queue, exchange })
    const serverMock = jest.fn(async () => {
      await wait(100)
      return getRandomServerData()
    })
    const serverErrMock = jest.fn()
    server.onData(serverMock, serverErrMock)
    await wait(2000)
    await serverConn.close()

    await managementApi.deleteQueue(queue)
    await managementApi.deleteExchange(exchange)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(serverMock.mock.calls.map((d: any) => d[0] && d[0].url)).toEqual(
      new Array(9)
        .fill(0)
        .map((d, i) => (i + 1).toString())
        .reverse() // ['9', '8', ..., '1']
    )
    expect(serverErrMock).not.toHaveBeenCalled()
  })

  it('正常错误消息处理', async () => {
    const { client, server, dispose } = await getConnPair()

    const clientMock = jest.fn()
    const clientErrMock = jest.fn()
    const serverMock = jest.fn()
    const serverErrMock = jest.fn()

    client.on('data', clientMock)
    client.on('error', clientErrMock)
    const sendData = getRandomClientData()
    await client.sendToQueue({
      id: 'test-id',
      ...sendData,
    })

    const serverResp = getRandomServerData({
      errorCode: 500,
      errorMsg: 'error message',
    })
    serverMock.mockResolvedValue(serverResp)
    server.onData(serverMock, serverErrMock)

    await wait(100)

    expect(clientMock).not.toHaveBeenCalled()
    expect(clientErrMock).toBeCalledWith(new Error('error message'), {
      id: 'test-id',
      ...serverResp,
    })
    expect(serverMock).toBeCalledWith({
      taskId: 'test-id',
      ...sendData,
    })
    expect(serverErrMock).not.toHaveBeenCalled()

    await dispose()
  })

  it('服务端异常处理', async () => {
    const { client, server, dispose } = await getConnPair()

    const clientMock = jest.fn()
    const clientErrMock = jest.fn()
    const serverMock = jest.fn()
    const serverErrMock = jest.fn()

    client.on('data', clientMock)
    client.on('error', clientErrMock)
    const sendData = getRandomClientData()
    await client.sendToQueue({
      id: 'test-id',
      ...sendData,
    })

    serverMock.mockRejectedValue(new Error('server error'))
    server.onData(serverMock, serverErrMock)

    await wait(100)

    expect(clientMock).not.toHaveBeenCalled()
    expect(clientErrMock).not.toHaveBeenCalled()
    expect(serverMock).toBeCalledWith({
      taskId: 'test-id',
      ...sendData,
    })
    expect(serverErrMock).toBeCalledWith(new Error('server error'))

    await dispose()
  })

  it('任务超时处理', async () => {
    const { client, server, dispose } = await getConnPair()

    const clientMock = jest.fn()
    const clientErrMock = jest.fn()
    const serverMock = jest.fn()
    const serverErrMock = jest.fn()

    client.on('data', clientMock)
    client.on('error', clientErrMock)
    const sendData = getRandomClientData()

    await client.sendToQueue({
      id: 'test-id',
      ...sendData,
    })

    serverMock.mockImplementation(() => new Promise(() => {}))
    server.onData(serverMock, serverErrMock)

    await wait(2000)

    expect(clientMock).not.toHaveBeenCalled()
    expect(clientErrMock).not.toHaveBeenCalled()
    expect(serverMock).toBeCalledWith({
      taskId: 'test-id',
      ...sendData,
    })
    expect(serverErrMock).toBeCalledWith(new Error('timeout of 1000ms exceeded'))

    await dispose()
  })
})

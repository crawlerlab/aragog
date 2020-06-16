/* eslint-disable @typescript-eslint/no-explicit-any */
import { connect } from '../client/src'
import {
  connParam,
  createConnection,
  createServer,
  getRandomClientData,
  getRandomServerData,
} from './utils/amqp'

const wait = (time: number): Promise<void> => new Promise((r) => setTimeout(r, time))

enum TaskType {
  Headless = 'headless',
  Source = 'source',
}

describe('客户端', () => {
  it.each([
    [{ username: 'u', password: 'p', appName: 'a' }, 'hostname is required'],
    [{ hostname: 'h', password: 'p', appName: 'a' }, 'username is required'],
    [{ hostname: 'h', username: 'u', appName: 'a' }, 'password is required'],
    [{ hostname: 'h', username: 'u', password: 'p' }, 'appName is required'],
    [
      { hostname: 1, username: 'u', password: 'p', appName: 'a' },
      'hostname must be of type string',
    ],
    [
      { hostname: 'h', username: 1, password: 'p', appName: 'a' },
      'username must be of type string',
    ],
    [
      { hostname: 'h', username: 'u', password: 1, appName: 'a' },
      'password must be of type string',
    ],
    [{ hostname: 'h', username: 'u', password: 'p', appName: 1 }, 'appName must be of type string'],
  ])('连接参数校验-%#', async (input, errMsg) => {
    await expect(connect(input as any)).rejects.toThrow(errMsg)
  })

  it('任务类型参数校验', async () => {
    const { hostname, username, password } = connParam
    const clientConn = await connect({
      appName: 'test',
      hostname,
      username,
      password,
    })
    const headlessTask = getRandomClientData()
    await expect(
      clientConn.addTask('my-type' as any, {
        id: 'headless-id',
        ...headlessTask,
      })
    ).rejects.toThrow('TaskType should be headless or source')
    await expect(clientConn.getQueueInfo('my-type' as any)).rejects.toThrow(
      'TaskType should be headless or source'
    )
  })

  it('优先级参数范围', async () => {
    const { hostname, username, password } = connParam
    const clientConn = await connect({
      appName: 'test',
      hostname,
      username,
      password,
    })
    const headlessTask = getRandomClientData()

    const ERR_MSG = 'priority between 0-10'
    await expect(
      clientConn.addTask(TaskType.Headless, {
        ...headlessTask,
        id: 'headless-id',
        priority: 0,
      })
    ).resolves.not.toThrow(ERR_MSG)
    await expect(
      clientConn.addTask(TaskType.Headless, {
        ...headlessTask,
        id: 'headless-id',
        priority: 10,
      })
    ).resolves.not.toThrow(ERR_MSG)
    await expect(
      clientConn.addTask(TaskType.Headless, {
        ...headlessTask,
        id: 'headless-id',
        priority: -1,
      })
    ).rejects.toThrow(ERR_MSG)
    await expect(
      clientConn.addTask(TaskType.Headless, {
        ...headlessTask,
        id: 'headless-id',
        priority: 11,
      })
    ).rejects.toThrow(ERR_MSG)
  })

  it('多队列通信', async () => {
    const { hostname, username, password } = connParam
    const clientConn = await connect({
      appName: 'test',
      hostname,
      username,
      password,
    })
    const serverConn = await createConnection()
    const headlessTask = getRandomClientData()
    const sourceTask = getRandomClientData()
    const headlessResponse = getRandomServerData()
    const sourceResponse = getRandomServerData()
    const sourceErrResp = getRandomServerData({
      errorCode: 500,
      errorMsg: 'error message',
    })

    const clientMock = jest.fn()
    const headlessMock = jest.fn().mockResolvedValue(headlessResponse)
    const sourceMock = jest
      .fn()
      .mockResolvedValueOnce(sourceResponse)
      .mockResolvedValueOnce(sourceErrResp)
    const headlessErrorMock = jest.fn()
    const sourceErrorMock = jest.fn()

    // server
    const headlessQueue = await createServer(serverConn, {
      queue: TaskType.Headless,
      exchange: 'aragog_exchange',
    })
    const sourceQueue = await createServer(serverConn, {
      queue: TaskType.Source,
      exchange: 'aragog_exchange',
    })
    headlessQueue.onData(headlessMock, headlessErrorMock)
    sourceQueue.onData(sourceMock, sourceErrorMock)

    // client
    clientConn.onTaskCompleted(clientMock)
    clientConn.addTask(TaskType.Headless, {
      id: 'headless-id',
      ...headlessTask,
    })
    clientConn.addTask(TaskType.Source, {
      id: 'source-id',
      ...sourceTask,
    })
    clientConn.addTask(TaskType.Source, {
      id: 'source-error-id',
      ...sourceTask,
    })

    await wait(500)
    await clientConn.close()
    await serverConn.close()

    expect(headlessMock).toBeCalledWith({
      taskId: 'headless-id',
      ...headlessTask,
    })
    expect(sourceMock).toBeCalledWith({
      taskId: 'source-id',
      ...sourceTask,
    })
    expect(headlessErrorMock).not.toHaveBeenCalled()
    expect(sourceErrorMock).not.toHaveBeenCalled()
    expect(clientMock.mock.calls).toContainEqual([
      undefined,
      {
        id: 'headless-id',
        ...headlessResponse,
      },
    ])
    expect(clientMock.mock.calls).toContainEqual([
      undefined,
      {
        id: 'source-id',
        ...sourceResponse,
      },
    ])
    expect(clientMock.mock.calls).toContainEqual([
      new Error('error message'),
      {
        id: 'source-error-id',
        ...sourceErrResp,
      },
    ])
  })

  it('获取服务器信息', async () => {
    const { hostname, username, password } = connParam
    const clientConn = await connect({
      appName: 'test',
      hostname,
      username,
      password,
    })

    await expect(clientConn.getQueueInfo(TaskType.Source)).resolves.toEqual(expect.any(Object))
    await expect(clientConn.getServerInfo()).resolves.toEqual(expect.any(Array))

    await clientConn.close()
  })

  it('客户端关闭连接', async () => {
    const { hostname, username, password } = connParam
    const clientConn = await connect({
      appName: 'test',
      hostname,
      username,
      password,
    })
    await clientConn.close()
    await expect(
      clientConn.addTask(TaskType.Source, {
        id: 'id',
        ...getRandomClientData(),
      })
    ).rejects.toThrow('connection closed')
    expect(() => {
      clientConn.onTaskCompleted(() => {})
    }).toThrow('connection closed')
  })
})

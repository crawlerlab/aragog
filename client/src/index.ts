import { AmqpConn } from 'types/amqp'
import Amqp, { Connection, SendData, ResultData } from './amqp'
import { createManagementApi, QueueInfo, ConsumerInfo } from './management'
import { checkConnectParam, checkTaskInput } from './utils'

export enum TaskType {
  Headless = 'headless',
  Source = 'source',
}

interface Options {
  ssl?: boolean
  durable?: boolean
  exchangeName?: string
}

interface TaskCompletedCallback {
  (error: Error | undefined, data: ResultData): void | Promise<void>
}

const taskTypeNotFoundError = (): void => {
  throw new Error('TaskType should be headless or source')
}

const connectionClosedError = (): void => {
  throw new Error('connection closed')
}

class Aragog {
  isClosed = false

  constructor(
    readonly connection: Connection,
    readonly managementApi: ReturnType<typeof createManagementApi>,
    readonly headlessClient: Amqp,
    readonly sourceClient: Amqp,
    readonly options: Options
  ) {}

  public async addTask(type: TaskType, data: SendData): Promise<void> {
    if (this.isClosed) {
      connectionClosedError()
    }
    checkTaskInput(data)
    if (type === TaskType.Headless) {
      await this.headlessClient.sendToQueue(data)
    } else if (type === TaskType.Source) {
      await this.sourceClient.sendToQueue(data)
    } else {
      taskTypeNotFoundError()
    }
  }

  public onTaskCompleted(callback: TaskCompletedCallback): void {
    if (this.isClosed) {
      connectionClosedError()
    }
    this.headlessClient.on('data', (data) => callback(undefined, data))
    this.headlessClient.on('error', callback)
    this.sourceClient.on('data', (data) => callback(undefined, data))
    this.sourceClient.on('error', callback)
  }

  public async getServerInfo(): Promise<ConsumerInfo[]> {
    return this.managementApi.getConsumers()
  }

  public async getQueueInfo(type: TaskType): Promise<QueueInfo> {
    if (![TaskType.Headless, TaskType.Source].includes(type)) {
      taskTypeNotFoundError()
    }
    return this.managementApi.getQueueInfo(type)
  }

  public async close(): Promise<void> {
    await this.connection.close()
    this.isClosed = true
  }
}

const connect = async (
  connParam: AmqpConn & { appName: string },
  userOpts: Options = {}
): Promise<Aragog> => {
  checkConnectParam(connParam)
  const options: Required<Options> = {
    exchangeName: 'aragog_exchange',
    durable: false,
    ssl: false,
    ...userOpts,
  }
  const conn = await Amqp.createConnect(connParam)
  const headlessClient = new Amqp(
    conn,
    {
      app: connParam.appName,
      queue: TaskType.Headless,
      exchange: options.exchangeName,
    },
    options
  )
  await headlessClient.init()
  const sourceClient = new Amqp(
    conn,
    {
      app: connParam.appName,
      queue: TaskType.Source,
      exchange: options.exchangeName,
    },
    options
  )
  await sourceClient.init()
  return new Aragog(
    conn,
    createManagementApi(connParam, options),
    headlessClient,
    sourceClient,
    options
  )
}

export { connect, SendData as Task, ResultData as TaskResult, QueueInfo, ConsumerInfo }

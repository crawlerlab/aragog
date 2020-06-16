import { EventEmitter } from 'events'
import amqp from 'amqplib'
import { QueueItem, AmqpConn, QueueResult } from 'types/amqp'

type Connection = amqp.Connection

export interface QueueParam {
  app: string
  queue: string
  exchange: string
}

export interface Options {
  durable?: boolean
}

export interface SendData extends QueueItem {
  id: string
  priority?: number
}

export interface ResultData extends QueueResult {
  id: string
}

class Amqp extends EventEmitter {
  static async createConnect(conn: AmqpConn): Promise<Connection> {
    return amqp.connect(conn)
  }

  private initialized = false

  private channel: amqp.Channel | null = null

  private callbackQueueName = ''

  readonly options: Required<Options>

  constructor(readonly connection: Connection, readonly param: QueueParam, userOpts = {}) {
    super()
    this.options = {
      durable: false,
      ...userOpts,
    }
    this.once('newListener', this.startMonitor)
  }

  public async init(): Promise<void> {
    this.channel = await this.connection.createChannel()
    await this.channel.assertExchange(this.param.exchange, 'topic')
    const dataQueue = await this.channel.assertQueue(this.param.queue, {
      durable: true,
      maxPriority: 10,
    })
    let callbackQueue: amqp.Replies.AssertQueue
    if (this.options.durable) {
      callbackQueue = await this.channel.assertQueue(
        `${this.param.app}_${this.param.queue}_result`,
        {
          durable: true,
        }
      )
    } else {
      callbackQueue = await this.channel.assertQueue('', { exclusive: true })
    }
    await this.channel.bindQueue(dataQueue.queue, this.param.exchange, `#.${this.param.queue}`)
    this.callbackQueueName = callbackQueue.queue
    this.initialized = true
  }

  public async sendToQueue({ id, priority = 0, ...data }: SendData): Promise<void> {
    if (!this.initialized || !this.channel) {
      throw new Error('uninitialized')
    }
    if (priority < 0 || priority > 10) {
      throw new Error('priority between 0-10')
    }
    const { exchange, app, queue } = this.param
    await this.channel.publish(exchange, `${app}.${queue}`, Buffer.from(JSON.stringify(data)), {
      priority,
      persistent: true,
      correlationId: id,
      replyTo: this.callbackQueueName,
    })
  }

  private startMonitor(): void {
    if (!this.initialized || !this.channel) {
      throw new Error('uninitialized')
    }
    this.channel.consume(
      this.callbackQueueName,
      (msg) => {
        if (msg) {
          try {
            const id: string = msg.properties.correlationId
            const result: ResultData = JSON.parse(msg.content.toString())
            if (typeof result !== 'object') {
              throw new Error('cannot parse result')
            }
            if (result.errorCode) {
              this.emit('error', new Error(result.errorMsg), { ...result, id })
            } else {
              this.emit('data', { ...result, id })
            }
          } catch (error) {
            this.emit('error', error)
          }
        }
      },
      { noAck: true }
    )
  }
}

export default Amqp

export { Connection }

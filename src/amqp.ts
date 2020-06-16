import amqp from 'amqplib'
import { QueueItem, AmqpConn, QueueResult, Task } from 'types/amqp'
import { amqpLog } from './log'
import { logPrefix } from './utils'

export interface QueueParam {
  queue: string
  exchange: string
  prefetch: number
}

class Amqp {
  static async createConnect(conn: AmqpConn): Promise<amqp.Connection> {
    return amqp.connect(conn)
  }

  constructor(readonly connection: amqp.Connection, readonly param: QueueParam) {}

  private async init(): Promise<amqp.Channel> {
    const { queue, exchange, prefetch } = this.param
    const channel = await this.connection.createChannel()
    await channel.assertExchange(exchange, 'topic')
    const dataQueue = await channel.assertQueue(queue, {
      durable: true,
      maxPriority: 10,
    })
    await channel.bindQueue(dataQueue.queue, exchange, `#.${queue}`)
    channel.prefetch(prefetch)
    return channel
  }

  public async onData(
    callback: (data: Task) => Promise<QueueResult>,
    onError: (error: Error) => Promise<void> | void
  ): Promise<void> {
    const log = logPrefix(amqpLog, this.param.queue)
    const channel = await this.init()
    log.debug(`init done`)
    channel.consume(this.param.queue, async (msg) => {
      if (msg) {
        try {
          const { correlationId, replyTo } = msg.properties
          const data: QueueItem = JSON.parse(msg.content.toString())
          log.info(`[${correlationId}] received\n`, data)
          let result: QueueResult
          try {
            result = await callback({
              taskId: correlationId,
              ...data,
            })
          } catch (error) {
            channel.reject(msg)
            log.error(`[${correlationId}] callback execution failed`)
            onError(error)
            return
          }
          log.info(`[${correlationId}] reply to ${replyTo}:\n`, result)
          await channel.sendToQueue(replyTo, Buffer.from(JSON.stringify(result)), {
            correlationId,
          })
          log.debug(`[${correlationId}] send success`)
          channel.ack(msg)
        } catch (error) {
          log.error(`failed to send`, error)
          channel.reject(msg)
        }
      }
    })
  }
}

export default Amqp

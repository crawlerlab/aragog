import amqp from 'amqplib'
import { QueueItem, AmqpConn, QueueResult, Task } from 'types/amqp'
import config from './config'
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
    const log = logPrefix(amqpLog, `[${queue}]`)
    log.debug('create channel...')
    const channel = await this.connection.createChannel()
    log.debug('assert exchange...')
    await channel.assertExchange(exchange, 'topic')
    log.debug('assert queue...')
    const dataQueue = await channel.assertQueue(queue, {
      durable: true,
      maxPriority: 10,
    })
    const key = `#.${queue}`
    log.debug('bind queue...\n', {
      queue: dataQueue.queue,
      exchange,
      key,
    })
    await channel.bindQueue(dataQueue.queue, exchange, key)
    log.debug('prefetch:', prefetch)
    channel.prefetch(prefetch)
    log.debug(`init done`)
    return channel
  }

  public async onData(
    callback: (data: Task) => Promise<QueueResult>,
    onError: (error: Error) => Promise<void> | void
  ): Promise<void> {
    const channel = await this.init()
    channel.consume(this.param.queue, async (msg) => {
      if (msg) {
        try {
          const { correlationId, replyTo } = msg.properties
          const data: QueueItem = JSON.parse(msg.content.toString())
          const log = logPrefix(
            amqpLog,
            `[${this.param.queue}] [${data.appName}] [${correlationId}]`
          )
          log.info(`received:\n`, data)
          let result: QueueResult
          try {
            result = await Promise.race([
              callback({ taskId: correlationId, ...data }),
              new Promise<QueueResult>((resolve, reject) => {
                const timeout = config.amqp.messageTimeout * 1000
                setTimeout(() => {
                  reject(new Error(`timeout of ${timeout}ms exceeded`))
                }, timeout)
              }),
            ])
          } catch (error) {
            channel.reject(msg)
            log.error(`callback execution failed:`, error)
            onError(error)
            return
          }
          log.info(`reply to ${replyTo}:\n`, result)
          await channel.sendToQueue(replyTo, Buffer.from(JSON.stringify(result)), {
            correlationId,
          })
          log.debug(`reply success`)
          channel.ack(msg)
        } catch (error) {
          amqpLog.error(`[${this.param.queue}] failed to send:`, error)
          channel.reject(msg)
          onError(error)
        }
      }
    })
  }
}

export default Amqp

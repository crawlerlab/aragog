import { Task } from 'types/amqp'
import Amqp from './amqp'
import config from './config'
import { amqpLog, headlessLog, sourceLog } from './log'
import { checkTaskInput, ErrCode } from './utils'
import runHeadlessTask from './headless'
import runSourceTask from './source'

const main = async (): Promise<void> => {
  const conn = await Amqp.createConnect(config.amqp.server)
  const headlessQueue = new Amqp(conn, config.amqp.headlessQueue)
  const sourceQueue = new Amqp(conn, config.amqp.sourceQueue)

  headlessQueue.onData(
    async (data: Task) => {
      try {
        checkTaskInput(data)
      } catch (error) {
        return {
          errorCode: ErrCode.InvalidParams,
          errorMsg: error instanceof Error ? error.message : '',
          startTime: Date.now(),
          endTime: Date.now(),
        }
      }
      return runHeadlessTask(data)
    },
    (error) => {
      headlessLog.error('crash:', error)
    }
  )

  sourceQueue.onData(
    async (data: Task) => {
      try {
        checkTaskInput(data)
      } catch (error) {
        return {
          errorCode: ErrCode.InvalidParams,
          errorMsg: error instanceof Error ? error.message : '',
          startTime: Date.now(),
          endTime: Date.now(),
        }
      }
      return runSourceTask(data)
    },
    (error) => {
      sourceLog.error('crash:', error)
    }
  )
}

main()
  .then(() => {
    amqpLog.info('service started')
  })
  .catch((error) => {
    amqpLog.error('connect error:', error)
  })

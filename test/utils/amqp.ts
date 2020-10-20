/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import amqp from 'amqplib'
import axios from 'axios'
import { AmqpConn, QueueItem, QueueResult } from 'types/amqp'
import AmqpClient, { Options as ClientOptions } from '../../client/src/amqp'
import AmqpServer from '../../src/amqp'

export const connParam = {
  hostname: 'localhost',
  username: 'test',
  password: 'test',
}

export const createConnection = () => amqp.connect(connParam)

export const createClient = async (
  conn: amqp.Connection,
  { queue, exchange }: { queue: string; exchange: string },
  options?: ClientOptions
): Promise<AmqpClient> => {
  const client = new AmqpClient(
    conn,
    {
      app: 'test',
      queue,
      exchange,
    },
    options
  )
  await client.init()
  return client
}

export const createServer = async (
  conn: amqp.Connection,
  { queue, exchange }: { queue: string; exchange: string }
): Promise<AmqpServer> => {
  const server = new AmqpServer(conn, {
    queue,
    exchange,
    prefetch: 1,
  })
  return server
}

interface QueueInfo {
  backing_queue_status: {
    priority_lengths: {
      [key: number]: number
    }
  }
  messages: number
}

export const getRandomID = (): string => Math.random().toString(36).substr(2)

const random = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1) + min)

export const getRandomClientData = (data: Partial<QueueItem> = {}): QueueItem => {
  const id = getRandomID()
  return {
    appName: 'test',
    url: `url:${id}`,
    script: `script:${id}`,
    encoding: `encoding:${id}`,
    params: { a: '1', b: '2' },
    headers: { ID: id },
    timeout: random(1000, 60000),
    ...data,
  }
}

export const getRandomServerData = (data: Partial<QueueResult> = {}): QueueResult => {
  const id = getRandomID()
  return {
    data: [id],
    startTime: Date.now(),
    endTime: Date.now() + 1,
    ...data,
  }
}

const createManagementApi = (conn: AmqpConn) => {
  const request = axios.create({
    baseURL: `http://${conn.hostname}:${conn.port || 15672}/api/`,
    auth: {
      username: conn.username,
      password: conn.password,
    },
  })
  const vhost = encodeURIComponent(conn.vhost || '/')
  return {
    getQueueInfo: (name: string) =>
      request.get<QueueInfo>(`/queues/${vhost}/${name}`).then(({ data }) => data),
    deleteQueue: (name: string) =>
      request.delete(`/queues/${vhost}/${name}`).then(({ data }) => data),
    deleteExchange: (name: string) =>
      request.delete(`/exchanges/${vhost}/${name}`).then(({ data }) => data),
  }
}

export const managementApi = createManagementApi(connParam)

export const getConnPair = async () => {
  const clientConn = await createConnection()
  const serverConn = await createConnection()
  const queue = getRandomID()
  const exchange = getRandomID()
  const client = await createClient(clientConn, { queue, exchange })
  const server = await createServer(serverConn, { queue, exchange })
  const dispose = async (): Promise<void> => {
    await managementApi.deleteQueue(queue)
    await managementApi.deleteExchange(exchange)
    await clientConn.close()
    await serverConn.close()
  }
  return {
    queue,
    exchange,
    client,
    server,
    dispose,
  }
}

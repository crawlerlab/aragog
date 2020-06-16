import axios from 'axios'
import { AmqpConn } from 'types/amqp'

export interface QueueInfo {
  backing_queue_status: {
    priority_lengths: {
      [key: number]: number
    }
    avg_ack_egress_rate: number
    avg_ack_ingress_rate: number
    avg_egress_rate: number
    avg_ingress_rate: number
    len: number
  }
  consumers: number
  message_bytes: number
  messages: number
  name: string
  node: string
  state: string
  vhost: string
}

export interface ConsumerInfo {
  ack_required: boolean
  active: boolean
  activity_status: string
  channel_details: {
    connection_name: string
    name: string
    node: string
    number: number
    peer_host: string
    peer_port: number
    user: string
  }
  consumer_tag: string
  exclusive: boolean
  prefetch_count: number
  queue: {
    name: string
    vhost: string
  }
}

interface Options {
  ssl?: boolean
}
/* eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types */
export const createManagementApi = (conn: AmqpConn, { ssl = false }: Options) => {
  const request = axios.create({
    baseURL: `${ssl ? 'https' : 'http'}://${conn.hostname}:${conn.port || 15672}/api/`,
    auth: {
      username: conn.username,
      password: conn.password,
    },
  })
  const vhost = encodeURIComponent(conn.vhost || '/')
  return {
    getQueueInfo: (name: string): Promise<QueueInfo> =>
      request.get<QueueInfo>(`/queues/${vhost}/${name}`).then(({ data }) => data),
    getConsumers: (): Promise<ConsumerInfo[]> =>
      request.get<ConsumerInfo[]>(`/consumers/${vhost}`).then(({ data }) => data),
  }
}

import axios from "axios"
import { mockIssueCards } from "./mock-data"
import type { IssueCard, ApiResponse, ApiEvent } from "./types"

// API基础URL
const API_BASE_URL = "http://43.139.19.144:8000"

// 超时设置
const DEFAULT_TIMEOUT = 10000

// 重试配置
const MAX_RETRIES = 2
const RETRY_DELAY = 1000

// 获取认证令牌
const getAuthToken = (): string | null => {
  if (typeof window === "undefined") return null

  try {
    const storedUser = localStorage.getItem("user")
    if (storedUser) {
      const user = JSON.parse(storedUser)
      if (user.token) {
        return `${user.tokenType || "Bearer"} ${user.token}`
      }
    }
  } catch (error) {
    console.error("获取认证令牌失败:", error)
  }

  return null
}

/**
 * 带重试功能的API请求
 */
export async function fetchWithRetry<T>(url: string, options: RequestInit = {}, retries = MAX_RETRIES): Promise<T> {
  try {
    // 添加认证头
    const token = getAuthToken()
    const headers = new Headers(options.headers || {})

    if (token) {
      headers.set("Authorization", token)
    }

    const response = await fetch(url, {
      ...options,
      headers,
      signal: options.signal || AbortSignal.timeout(DEFAULT_TIMEOUT),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    return (await response.json()) as T
  } catch (error) {
    if (retries > 0) {
      console.log(`请求失败，${RETRY_DELAY}ms后重试，剩余重试次数: ${retries - 1}`)
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
      return fetchWithRetry<T>(url, options, retries - 1)
    }
    throw error
  }
}

// 从消息或摘要中提取位置信息
const extractLocation = (summary: string, messages: any[]): string => {
  // 尝试从摘要中提取位置
  const locationMatch = summary.match(/(\d+号楼|\w区|\w座)/)
  if (locationMatch && locationMatch[1]) {
    return locationMatch[1]
  }

  // 尝试从消息中提取位置
  for (const message of messages) {
    if (message.content) {
      const msgLocationMatch = message.content.match(/(\d+号楼|\w区|\w座)/)
      if (msgLocationMatch && msgLocationMatch[1]) {
        return msgLocationMatch[1]
      }
    }
  }

  return "未指定位置"
}

// 从事件类别确定责任单位
const determineResponsibleParty = (category: string): string => {
  switch (category) {
    case "质量问题":
      return "质量部"
    case "安全隐患":
      return "安全部"
    case "进度延误":
      return "工程部"
    case "材料问题":
      return "材料部"
    case "设备故障":
      return "设备部"
    case "讨论施工方案":
      return "技术部"
    default:
      return "待指定"
  }
}

// 状态类型定义
type IssueStatus = "待处理" | "整改中" | "待复核" | "已闭环"

// 将API事件转换为问题卡片
const convertEventToIssueCard = (event: ApiEvent): IssueCard => {
  // 提取第一条消息作为原始输入
  const firstMessage = event.messages && event.messages.length > 0 ? event.messages[0].content : ""

  // 提取所有消息ID
  const messageIds = event.messages ? event.messages.map((m) => m.message_id) : []

  // 提取图片URL
  const imageUrls =
    event.candidate_images && event.candidate_images.length > 0
      ? event.candidate_images.map((img) => img.image_data)
      : []

  // 从消息中提取位置
  const location = extractLocation(event.summary, event.messages)

  // 根据类别确定责任单位
  const responsibleParty = determineResponsibleParty(event.category)

  return {
    id: event.id.toString(),
    eventId: event.id,
    category: event.category,
    originalMessageIds: messageIds,
    reporterUserId: event.messages && event.messages.length > 0 ? event.messages[0].sender_id : "unknown",
    reporterName: "系统聚类",
    recordTimestamp: event.create_time,
    rawTextInput: firstMessage,
    imageUrls: imageUrls,
    candidateImages: event.candidate_images || [],
    description: event.summary,
    location: location,
    responsibleParty: responsibleParty,
    status: mapStatusCodeToStatus(event.status),
    lastUpdatedTimestamp: event.update_time,
    projectId: "project123",
    isDeleted: false,
    isMergedCard: event.is_merged,
  }
}

// 状态码映射函数
const mapStatusCodeToStatus = (statusCode: string): IssueStatus => {
  switch (statusCode) {
    case "0":
      return "待处理"
    case "1":
      return "整改中"
    case "2":
      return "待复核"
    case "3":
      return "已闭环"
    default:
      return "待处理"
  }
}

/**
 * 获取问题卡片，失败时使用模拟数据
 */
export async function getIssueCards(): Promise<IssueCard[]> {
  try {
    console.log("尝试从API获取问题卡片...")

    // 获取认证令牌
    const token = getAuthToken()
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    }

    if (token) {
      headers["Authorization"] = token
    }

    const response = await axios.get<ApiResponse>(`${API_BASE_URL}/events-db`, {
      timeout: DEFAULT_TIMEOUT,
      headers,
    })

    if (response.data && response.data.events) {
      console.log(`成功从API获取 ${response.data.events.length} 个问题卡片`)

      // 将API返回的事件转换为问题卡片格式
      return response.data.events.map(convertEventToIssueCard)
    }

    throw new Error("API响应格式不正确")
  } catch (error) {
    console.error("获取问题卡片失败，使用模拟数据:", error)
    return mockIssueCards
  }
}

/**
 * 检查API服务器状态
 */
export async function checkApiStatus(): Promise<{
  isAvailable: boolean
  message: string
  timestamp: string
}> {
  try {
    const startTime = Date.now()
    const response = await axios.get(`${API_BASE_URL}/events-db`, {
      timeout: 5000, // 较短的超时时间用于状态检查
      headers: {
        Accept: "application/json",
        Authorization: getAuthToken() || "",
      },
    })
    const endTime = Date.now()

    return {
      isAvailable: true,
      message: `API服务器可用，响应时间: ${endTime - startTime}ms`,
      timestamp: new Date().toISOString(),
    }
  } catch (error) {
    return {
      isAvailable: false,
      message: error instanceof Error ? error.message : "未知错误",
      timestamp: new Date().toISOString(),
    }
  }
}

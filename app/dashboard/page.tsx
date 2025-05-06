"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { FilterBar } from "@/components/filter-bar"
import { useAuth } from "@/lib/auth-provider"
import type { IssueCard, IssueStatus, ApiResponse, ApiEvent } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { MessageSquare, Loader2, Merge, AlertTriangle } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { FeishuChatSimulator } from "@/components/feishu-chat-simulator"
import { DocumentGenerationButton } from "@/components/document-generation-button"
import axios from "axios"
import { GroupedIssueList } from "@/components/grouped-issue-list"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { MergeConfirmationDialog } from "@/components/merge-confirmation-dialog"
import debounce from "lodash/debounce"
import { mockIssueCards } from "@/lib/mock-data" // 导入模拟数据

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

// API状态检查组件
const APIStatusChecker = () => {
  const [apiStatus, setApiStatus] = useState<"loading" | "online" | "offline">("loading")

  useEffect(() => {
    const checkAPIStatus = async () => {
      try {
        const response = await axios.get("/api/health")
        if (response.status === 200) {
          setApiStatus("online")
        } else {
          setApiStatus("offline")
        }
      } catch (error) {
        console.error("API Health Check Failed:", error)
        setApiStatus("offline")
      }
    }

    checkAPIStatus()
  }, [])

  let statusText = ""
  let statusColor = "text-gray-500"
  let icon = null

  switch (apiStatus) {
    case "loading":
      statusText = "检查API状态..."
      icon = <Loader2 className="h-4 w-4 animate-spin mr-2" />
      break
    case "online":
      statusText = "API连接正常"
      statusColor = "text-green-500"
      break
    case "offline":
      statusText = "API连接异常"
      statusColor = "text-red-500"
      icon = <AlertTriangle className="h-4 w-4 mr-2" />
      break
  }

  return (
    <div className={`flex items-center text-sm ${statusColor}`}>
      {icon}
      {statusText}
    </div>
  )
}

export default function DashboardPage() {
  const router = useRouter()
  const { user, isAuthenticated } = useAuth()
  const { toast } = useToast()
  const [issueCards, setIssueCards] = useState<IssueCard[]>([])
  const [filteredIssues, setFilteredIssues] = useState<IssueCard[]>([])
  const [selectedIssues, setSelectedIssues] = useState<string[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<IssueStatus[]>([])
  const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  })
  const [viewMode, setViewMode] = useState<"grouped" | "list">("grouped")
  const [showChatSimulator, setShowChatSimulator] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [cardToDelete, setCardToDelete] = useState<{ id: string; eventId: number | null }>({ id: "", eventId: null })
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const [lastFetchTime, setLastFetchTime] = useState<number>(0)
  const [useMockData, setUseMockData] = useState(false) // 默认使用API数据
  const CACHE_DURATION = 30000 // 30秒缓存

  // 将fetchIssueCards改为useCallback包装的函数
  const fetchIssueCards = useCallback(
    debounce(async () => {
      setIsLoading(true)
      try {
        if (useMockData) {
          // 使用模拟数据
          console.log("使用模拟数据")
          setIssueCards(mockIssueCards)
          setFilteredIssues(mockIssueCards)
          setSelectedIssues([])
          toast({
            title: "加载模拟数据成功",
            description: `成功加载 ${mockIssueCards.length} 个模拟问题卡片`,
          })
          setIsLoading(false)
          return
        }

        // 直接从API获取数据
        console.log("从API获取数据")
        const API_BASE_URL = "http://43.139.19.144:8000"

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
          timeout: 10000,
          headers,
        })

        if (response.data && response.data.events) {
          console.log(`成功从API获取 ${response.data.events.length} 个事件`)

          // 将API返回的事件转换为问题卡片格式
          const cards: IssueCard[] = response.data.events.map(convertEventToIssueCard)

          setIssueCards(cards)
          setFilteredIssues(cards)
          setSelectedIssues([])

          toast({
            title: "获取问题卡片成功",
            description: `成功获取 ${cards.length} 个问题卡片`,
          })
        }
      } catch (error) {
        console.error("获取问题卡片失败:", error)
        toast({
          title: "获取问题卡片失败",
          description: "无法获取问题卡片数据，请稍后再试",
          variant: "destructive",
        })

        // 失败时使用模拟数据
        setIssueCards(mockIssueCards)
        setFilteredIssues(mockIssueCards)
      } finally {
        setIsLoading(false)
      }
    }, 500),
    [toast, useMockData],
  )

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

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/login")
    }
  }, [isAuthenticated, router])

  const handleDeleteCard = async (cardId: string, eventId: number | null) => {
    if (!eventId) {
      toast({
        title: "删除失败",
        description: "无法删除此卡片，未找到对应的事件ID",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    try {
      // 确保eventId是数字类型
      const numericEventId = Number(eventId)

      // 添加错误处理和详细日志
      console.log(`尝试删除卡片，ID: ${cardId}, 事件ID: ${numericEventId}`)

      if (useMockData) {
        // 如果使用模拟数据，只在前端删除
        setIssueCards((prev) => prev.filter((card) => card.id !== cardId))
        setSelectedIssues((prev) => prev.filter((id) => id !== cardId))
        toast({
          title: "删除成功",
          description: `卡片 #${cardId} 已成功删除`,
        })
        setIsLoading(false)
        setDeleteDialogOpen(false)
        return
      }

      // 修改为使用GET请求删除卡片，直接使用eventId作为路径参数
      const response = await axios.get(`/api/events/${numericEventId}`, {
        // 添加超时设置
        timeout: 10000,
        // 添加错误处理选项
        validateStatus: (status) => {
          return status >= 200 && status < 300 // 只接受2xx状态码为成功
        },
      })

      if (response.status === 200) {
        // 从状态中移除已删除的卡片
        setIssueCards((prev) => prev.filter((card) => card.id !== cardId))
        // 如果卡片在选中列表中，也从中移除
        setSelectedIssues((prev) => prev.filter((id) => id !== cardId))

        toast({
          title: "删除成功",
          description: `卡片 #${cardId} 已成功删除`,
        })
      }
    } catch (error: any) {
      console.error("删除卡片失败:", error)
      // 提供更详细的错误信息
      const errorMessage = error.response?.data?.error || error.message || "未知错误"
      toast({
        title: "删除失败",
        description: `无法删除卡片: ${errorMessage}`,
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
      setDeleteDialogOpen(false)
    }
  }

  // 合并卡片功能
  const handleMergeCards = async () => {
    if (selectedIssues.length < 2) {
      toast({
        title: "无法合并",
        description: "请至少选择两张卡片进行合并",
        variant: "destructive",
      })
      return
    }

    // 获取选中卡片的eventId
    const selectedEventIds = selectedIssues
      .map((id) => {
        const card = issueCards.find((card) => card.id === id)
        return card?.eventId
      })
      .filter((id): id is number => id !== undefined)

    if (selectedEventIds.length < 2) {
      toast({
        title: "无法合并",
        description: "选中的卡片中没有足够的有效事件ID",
        variant: "destructive",
      })
      return
    }

    setMergeDialogOpen(true)
  }

  const confirmMergeCards = async () => {
    setIsMerging(true)
    try {
      // 获取选中卡片的eventId
      const selectedEventIds = selectedIssues
        .map((id) => {
          const card = issueCards.find((card) => card.id === id)
          return card?.eventId
        })
        .filter((id): id is number => id !== undefined)

      if (useMockData) {
        // 如果使用模拟数据，只在前端模拟合并
        toast({
          title: "合并成功",
          description: "卡片已成功合并（模拟数据）",
        })
        setIsMerging(false)
        setMergeDialogOpen(false)
        return
      }

      // 调用合并API
      const response = await axios.post("/api/merge-events", {
        event_ids: selectedEventIds,
      })

      if (response.data) {
        toast({
          title: "合并成功",
          description: "卡片已成功合并，正在刷新数据...",
        })

        // 刷新卡片列表
        await fetchIssueCards()
      }
    } catch (error) {
      console.error("合并卡片失败:", error)
      toast({
        title: "合并失败",
        description: "无法合并选中的卡片，请稍后再试",
        variant: "destructive",
      })
    } finally {
      setIsMerging(false)
      setMergeDialogOpen(false)
    }
  }

  // 组件挂载时获取问题卡片
  useEffect(() => {
    if (isAuthenticated) {
      fetchIssueCards()
    }
  }, [isAuthenticated, fetchIssueCards])

  useEffect(() => {
    let filtered = [...issueCards]

    // Apply status filter
    if (statusFilter.length > 0) {
      filtered = filtered.filter((issue) => statusFilter.includes(issue.status))
    }

    // Apply date range filter
    if (dateRange.from) {
      filtered = filtered.filter((issue) => {
        const issueDate = new Date(issue.recordTimestamp)
        return issueDate >= dateRange.from!
      })
    }

    if (dateRange.to) {
      filtered = filtered.filter((issue) => {
        const issueDate = new Date(issue.recordTimestamp)
        return issueDate <= dateRange.to!
      })
    }

    // Apply search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(
        (issue) =>
          issue.description.toLowerCase().includes(query) ||
          issue.location.toLowerCase().includes(query) ||
          issue.responsibleParty.toLowerCase().includes(query) ||
          issue.rawTextInput.toLowerCase().includes(query) ||
          issue.category.toLowerCase().includes(query),
      )
    }

    setFilteredIssues(filtered)
  }, [issueCards, statusFilter, dateRange, searchQuery])

  const handleIssueUpdate = (updatedIssue: IssueCard) => {
    // 更新本地状态
    const updatedIssues = issueCards.map((issue) => (issue.id === updatedIssue.id ? updatedIssue : issue))
    setIssueCards(updatedIssues)

    toast({
      title: "问题记录已更新",
      description: `问题记录 #${updatedIssue.id} 已成功更新`,
    })
  }

  const handleIssueSelect = (issueId: string, selected: boolean) => {
    if (selected) {
      setSelectedIssues((prev) => [...prev, issueId])
    } else {
      setSelectedIssues((prev) => prev.filter((id) => id !== issueId))
    }
  }

  const handleIssueDelete = (issueId: string, eventId: number | null) => {
    // 打开确认对话框
    setCardToDelete({ id: issueId, eventId })
    setDeleteDialogOpen(true)
  }

  // 检查是否有已合并的卡片被选中
  const hasMergedCardsSelected = selectedIssues.some((id) => {
    const card = issueCards.find((card) => card.id === id)
    return card?.status === "已合并"
  })

  const handleRefreshClick = () => {
    const now = Date.now()
    if (now - lastFetchTime > CACHE_DURATION || issueCards.length === 0) {
      fetchIssueCards()
      setLastFetchTime(now)
    } else {
      toast({
        title: "数据已是最新",
        description: `数据已在${Math.round((now - lastFetchTime) / 1000)}秒前更新过`,
      })
    }
  }

  // 切换数据源
  const toggleDataSource = () => {
    setUseMockData(!useMockData)
    // 切换后重新加载数据
    setTimeout(() => {
      fetchIssueCards()
    }, 100)
  }

  if (!isAuthenticated) {
    return null
  }

  if (showChatSimulator) {
    return (
      <FeishuChatSimulator
        onBackToDashboard={() => {
          setShowChatSimulator(false)
          // 返回到问题记录页面时刷新卡片
          fetchIssueCards()
        }}
        onNewIssueCreated={() => {}} // 不再需要这个回调，因为我们会在返回时刷新
        currentUser={user!}
      />
    )
  }

  return (
    <div className="container mx-auto py-6 px-4 md:px-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-6">
        <h1 className="text-2xl font-bold">问题记录</h1>
        <APIStatusChecker />

        <div className="flex flex-wrap gap-2 mt-4 sm:mt-0">
          <Button variant="outline" size="sm" onClick={toggleDataSource} className="flex items-center gap-1">
            {useMockData ? "使用API数据" : "使用模拟数据"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowChatSimulator(true)}
            className="flex items-center gap-1"
          >
            <MessageSquare className="h-4 w-4" />
            飞书聊天
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={handleRefreshClick}
            disabled={isLoading}
            className="flex items-center gap-1"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "刷新问题卡片"}
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <FilterBar
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          dateRange={dateRange}
          setDateRange={setDateRange}
        />

        <div className="flex justify-between items-center mb-4">
          {selectedIssues.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">已选择 {selectedIssues.length} 张卡片</span>
              <Button variant="outline" size="sm" onClick={() => setSelectedIssues([])}>
                取消选择
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleMergeCards}
                disabled={selectedIssues.length < 2 || hasMergedCardsSelected}
                className="flex items-center gap-1"
              >
                <Merge className="h-4 w-4" />
                合并卡片
              </Button>
              {/* 添加文档生成按钮 */}
              <DocumentGenerationButton selectedCardIds={selectedIssues} />
            </div>
          )}

          <div className="border rounded-md overflow-hidden flex ml-auto">
            <Button
              variant={viewMode === "grouped" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("grouped")}
              className="rounded-none"
            >
              按责任单位分组
            </Button>
            <Button
              variant={viewMode === "list" ? "default" : "ghost"}
              size="sm"
              onClick={() => setViewMode("list")}
              className="rounded-none"
            >
              列表视图
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center items-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="ml-2">加载问题卡片中...</span>
          </div>
        ) : filteredIssues.length > 0 ? (
          <GroupedIssueList
            issues={filteredIssues}
            onIssueUpdate={handleIssueUpdate}
            onIssueDelete={handleIssueDelete}
            selectedIssues={selectedIssues}
            onIssueSelect={handleIssueSelect}
            documents={[]} // 不再需要文档
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <h3 className="text-lg font-medium">暂无问题记录</h3>
            <p className="text-sm text-muted-foreground mt-1">请在飞书聊天中发送消息并点击"自动聚类"按钮生成问题卡片</p>
          </div>
        )}
      </div>

      {/* 删除确认对话框 */}
      {deleteDialogOpen && (
        <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>确认删除卡片</AlertDialogTitle>
              <AlertDialogDescription>
                您确定要删除卡片 #{cardToDelete.id} 及其所有关联内容吗？此操作无法撤销。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => handleDeleteCard(cardToDelete.id, cardToDelete.eventId)}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* 合并确认对话框 */}
      <MergeConfirmationDialog
        isOpen={mergeDialogOpen}
        onClose={() => setMergeDialogOpen(false)}
        onConfirm={confirmMergeCards}
        selectedCount={selectedIssues.length}
        isMerging={isMerging}
      />
    </div>
  )
}

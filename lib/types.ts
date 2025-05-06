export type IssueStatus = "待处理" | "整改中" | "待复核" | "已闭环" | "已合并"

export interface CandidateImage {
  image_key: string
  sender_id: string
  timestamp: string
  image_data: string
  message_id: string
}

export interface EventMessage {
  type: string
  content: string
  sender_id: string
  timestamp: string
  message_id: string
}

export interface ApiEvent {
  id: number
  category: string
  summary: string
  status: string
  update_time: string
  create_time: string
  is_merged: boolean
  candidate_images: CandidateImage[]
  messages: EventMessage[]
}

export interface ApiResponse {
  events: ApiEvent[]
}

export interface IssueCard {
  id: string
  eventId: number
  category: string
  originalMessageIds: string[]
  reporterUserId: string
  reporterName: string
  recordTimestamp: string
  rawTextInput: string
  imageUrls: string[]
  candidateImages: CandidateImage[]
  description: string
  location: string
  responsibleParty: string
  status: IssueStatus
  lastUpdatedTimestamp: string
  projectId: string
  isDeleted: boolean
  isMergedCard: boolean
  mergedFromCardIds?: string[]
  mergedIntoCardId?: string
}

export interface GeneratedDocument {
  id: string
  documentType: "通知单" | "巡检记录"
  generationTimestamp: string
  generatedByUserId: string
  generatedByName: string
  sourceCardIds: string[]
  documentUrl: string
  documentIdentifier: string
}

export interface User {
  username: string
  name: string
}

export interface ApiDocument {
  id: number
  event_id: number
  doc_url: string
  event_summary: string | null
}

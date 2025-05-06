"use client"

import { useState } from "react"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Calendar, Clock, Edit, MapPin, Trash2, User, X, ExternalLink, Copy } from "lucide-react"
import type { IssueCard, GeneratedDocument, CandidateImage } from "@/lib/types"
import { formatDistanceToNow } from "date-fns"
import { zhCN } from "date-fns/locale"
import { useToast } from "@/components/ui/use-toast"
import axios from "axios"

interface IssueCardItemProps {
  issue: IssueCard
  onEditClick: (issue: IssueCard) => void
  onDeleteClick: (issue: IssueCard) => void
  isSelected: boolean
  onSelect: (selected: boolean) => void
  relatedDocuments?: GeneratedDocument[]
  onIssueUpdate?: (updatedIssue: IssueCard) => void
}

export function IssueCardItem({
  issue,
  onEditClick,
  onDeleteClick,
  isSelected,
  onSelect,
  relatedDocuments = [],
  onIssueUpdate,
}: IssueCardItemProps) {
  const { toast } = useToast()
  const [showImagePreview, setShowImagePreview] = useState(false)
  const [currentImageIndex, setCurrentImageIndex] = useState(0)
  const [isDeleting, setIsDeleting] = useState(false)

  // 格式化日期
  const formattedDate = formatDistanceToNow(new Date(issue.recordTimestamp), {
    addSuffix: true,
    locale: zhCN,
  })

  // 处理状态样式
  const getStatusStyle = () => {
    switch (issue.status) {
      case "待处理":
        return "bg-yellow-100 text-yellow-800 border-yellow-300"
      case "整改中":
        return "bg-blue-100 text-blue-800 border-blue-300"
      case "待复核":
        return "bg-purple-100 text-purple-800 border-purple-300"
      case "已闭环":
        return "bg-green-100 text-green-800 border-green-300"
      case "已合并":
        return "bg-gray-100 text-gray-800 border-gray-300"
      default:
        return "bg-gray-100 text-gray-800 border-gray-300"
    }
  }

  // 复制消息ID到剪贴板
  const copyMessageId = (messageId: string) => {
    navigator.clipboard.writeText(messageId)
    toast({
      title: "已复制消息ID",
      description: `消息ID ${messageId} 已复制到剪贴板`,
    })
  }

  // 删除图片
  const deleteImage = async (imageUrl: string) => {
    if (isDeleting) return

    setIsDeleting(true)
    try {
      // 查找匹配的candidateImage
      const candidateImage = findCandidateImageByUrl(imageUrl)

      if (!candidateImage || !candidateImage.message_id) {
        console.error("无法找到匹配的图片信息或消息ID", { imageUrl, candidateImages: issue.candidateImages })
        toast({
          title: "删除失败",
          description: "无法找到匹配的图片信息",
          variant: "destructive",
        })
        return
      }

      console.log("准备删除图片", {
        messageId: candidateImage.message_id,
        imageUrl: imageUrl,
      })

      // 调用代理API删除图片
      const response = await axios.post("/api/proxy/delete-image", {
        messageId: candidateImage.message_id,
      })

      if (response.status === 200) {
        // 更新本地状态，移除已删除的图片
        const updatedImageUrls = issue.imageUrls.filter((url) => url !== imageUrl)
        const updatedCandidateImages = issue.candidateImages.filter(
          (img) => img.message_id !== candidateImage.message_id,
        )

        const updatedIssue = {
          ...issue,
          imageUrls: updatedImageUrls,
          candidateImages: updatedCandidateImages,
        }

        // 如果提供了更新函数，则调用它
        if (onIssueUpdate) {
          onIssueUpdate(updatedIssue)
        }

        toast({
          title: "删除成功",
          description: "图片已成功删除",
        })

        // 如果当前正在预览被删除的图片，关闭预览
        if (showImagePreview && issue.imageUrls[currentImageIndex] === imageUrl) {
          setShowImagePreview(false)
        }
      }
    } catch (error) {
      console.error("删除图片失败:", error)
      toast({
        title: "删除失败",
        description: "无法删除图片，请稍后再试",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  // 根据URL查找匹配的candidateImage
  const findCandidateImageByUrl = (imageUrl: string): CandidateImage | undefined => {
    if (!issue.candidateImages || issue.candidateImages.length === 0) {
      return undefined
    }

    // 方法1: 直接匹配image_data
    const directMatch = issue.candidateImages.find((img) => img.image_data === imageUrl)
    if (directMatch) return directMatch

    // 方法2: 匹配图片文件名
    const urlParts = imageUrl.split("/")
    const filename = urlParts[urlParts.length - 1]

    const filenameMatch = issue.candidateImages.find((img) => {
      const imgParts = img.image_data.split("/")
      const imgFilename = imgParts[imgParts.length - 1]
      return imgFilename === filename
    })

    if (filenameMatch) return filenameMatch

    // 如果都找不到，返回第一个candidateImage
    return issue.candidateImages[0]
  }

  return (
    <Card className={`overflow-hidden ${issue.status === "已闭环" ? "opacity-80" : ""}`}>
      <CardHeader className="p-4 pb-0 flex flex-row items-start justify-between">
        <div className="flex items-start gap-2">
          <Checkbox
            checked={isSelected}
            onCheckedChange={onSelect}
            className="mt-1"
            disabled={issue.status === "已合并"}
          />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">#{issue.id}</h3>
              <Badge variant="outline" className="font-normal">
                {issue.category || "未分类"}
              </Badge>
              <Badge className={`border ${getStatusStyle()}`}>{issue.status}</Badge>
              {issue.isMergedCard && <Badge variant="outline">已合并</Badge>}
            </div>
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{issue.description}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4">
        {issue.imageUrls && issue.imageUrls.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 mb-4">
            {issue.imageUrls.slice(0, 4).map((imageUrl, index) => (
              <div key={index} className="relative group aspect-video bg-gray-100 rounded-md overflow-hidden">
                <img
                  src={imageUrl || "/placeholder.svg"}
                  alt={`问题图片 ${index + 1}`}
                  className="w-full h-full object-cover cursor-pointer"
                  onClick={() => {
                    setCurrentImageIndex(index)
                    setShowImagePreview(true)
                  }}
                  onError={(e) => {
                    e.currentTarget.src = "/placeholder.svg?key=image-error"
                  }}
                />
                <button
                  className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteImage(imageUrl)
                  }}
                  disabled={isDeleting}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            {issue.imageUrls.length > 4 && (
              <div
                className="flex items-center justify-center bg-gray-100 rounded-md cursor-pointer"
                onClick={() => {
                  setCurrentImageIndex(0)
                  setShowImagePreview(true)
                }}
              >
                <span className="text-sm font-medium">+{issue.imageUrls.length - 4} 更多</span>
              </div>
            )}
          </div>
        ) : (
          <div className="h-32 flex items-center justify-center bg-gray-100 rounded-md mb-4">
            <span className="text-sm text-muted-foreground">无图片</span>
          </div>
        )}

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <span>{issue.location || "未指定位置"}</span>
          </div>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <span>责任单位: {issue.responsibleParty}</span>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <span>记录时间: {new Date(issue.recordTimestamp).toLocaleString()}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span>更新于: {formattedDate}</span>
          </div>
        </div>
      </CardContent>

      <CardFooter className="p-4 pt-0 flex justify-between">
        <div className="flex gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={() => onEditClick(issue)}>
                  <Edit className="h-4 w-4 mr-1" />
                  编辑
                </Button>
              </TooltipTrigger>
              <TooltipContent>编辑问题记录</TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={() => onDeleteClick(issue)}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  删除
                </Button>
              </TooltipTrigger>
              <TooltipContent>删除问题记录</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {relatedDocuments && relatedDocuments.length > 0 && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" asChild>
                  <a href={relatedDocuments[0].documentUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-1" />
                    查看文档
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>查看关联文档</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </CardFooter>

      {/* 图片预览对话框 */}
      <Dialog open={showImagePreview} onOpenChange={setShowImagePreview}>
        <DialogContent className="max-w-4xl w-full p-0 overflow-hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>图片预览</DialogTitle>
          </DialogHeader>
          <div className="relative">
            <img
              src={issue.imageUrls[currentImageIndex] || "/placeholder.svg"}
              alt={`问题图片 ${currentImageIndex + 1}`}
              className="w-full h-auto max-h-[80vh] object-contain"
              onError={(e) => {
                e.currentTarget.src = "/placeholder.svg?key=image-error"
              }}
            />
            <button
              className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-2"
              onClick={() => setShowImagePreview(false)}
            >
              <X className="h-5 w-5" />
            </button>
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white p-2 flex justify-between items-center">
              <div>
                {currentImageIndex + 1} / {issue.imageUrls.length}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-white hover:bg-white/20"
                  onClick={() => deleteImage(issue.imageUrls[currentImageIndex])}
                  disabled={isDeleting}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  删除图片
                </Button>
                {issue.candidateImages && issue.candidateImages.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-white hover:bg-white/20"
                    onClick={() => {
                      const candidateImage = findCandidateImageByUrl(issue.imageUrls[currentImageIndex])
                      if (candidateImage && candidateImage.message_id) {
                        copyMessageId(candidateImage.message_id)
                      }
                    }}
                  >
                    <Copy className="h-4 w-4 mr-1" />
                    复制消息ID
                  </Button>
                )}
              </div>
            </div>
            {currentImageIndex > 0 && (
              <button
                className="absolute left-2 top-1/2 transform -translate-y-1/2 bg-black/60 text-white rounded-full p-2"
                onClick={() => setCurrentImageIndex(currentImageIndex - 1)}
              >
                &lt;
              </button>
            )}
            {currentImageIndex < issue.imageUrls.length - 1 && (
              <button
                className="absolute right-2 top-1/2 transform -translate-y-1/2 bg-black/60 text-white rounded-full p-2"
                onClick={() => setCurrentImageIndex(currentImageIndex + 1)}
              >
                &gt;
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

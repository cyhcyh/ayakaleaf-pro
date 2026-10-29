import { z } from 'zod';

const image = z.object({ type: z.literal('file'), mediaType: z.string().regex(/^image\/[a-z0-9.+-]+$/),
  filename: z.string().max(1000).optional(), url: z.string().max(9 * 1024 * 1024) })
  .refine(file => file.url.startsWith(`data:${file.mediaType};base64,`), '排队图片格式不正确');
export const outboxSchema = z.array(z.object({
  id: z.string().uuid(), text: z.string().max(200000), files: z.array(image).max(10),
  references: z.array(z.object({ id: z.string().uuid(), name: z.string().max(1000), mediaType: z.string().max(100) })).max(10).optional(),
  context: z.object({ path: z.string().min(1).max(1000), selection: z.array(z.object({
    fromLine: z.number().int().min(1), toLine: z.number().int().min(1), content: z.string().max(200000),
  })).max(100) }),
}).refine(item => item.text.trim() || item.files.length || item.references?.length, '排队消息不能为空')
  .refine(item => item.files.length + (item.references?.length || 0) <= 10, '每条消息最多附加 10 个文件。'))
  .max(100).refine(items => new Set(items.map(item => item.id)).size === items.length, '排队消息编号重复')
  .refine(items => Buffer.byteLength(JSON.stringify(items)) <= 9 * 1024 * 1024, '待发送内容过大，请减少附件后重试');

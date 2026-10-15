<script setup lang="ts">
import { MEDIA, type Post } from '~/fixtures/scenario'
import { TYPE_ICON, TYPE_LABEL, account, hhmm, postStatus, workspace } from '~/utils/format'

const props = defineProps<{ post: Post, showClient?: boolean, thumb?: number }>()
const ws = computed(() => workspace(props.post.workspaceId))
const st = computed(() => postStatus(props.post))
const platforms = computed(() => [...new Set(props.post.targets.map(t => account(t.accountId).platform))])
const n = computed(() => props.post.targets.length)
const a11y = computed(() => `${hhmm(props.post.scheduledAt)}, ${TYPE_LABEL[props.post.type]} di ${ws.value.short}, ${n.value} destinazioni, ${st.value.long ?? st.value.label}`)
</script>

<template>
  <NuxtLink :to="`/demo/post/${post.id}`" class="fw-card block p-2 hover:border-[var(--border-strong)] transition-colors" :aria-label="a11y">
    <div class="flex items-center gap-1.5 px-0.5 pb-2">
      <span class="tabular text-sm font-bold">{{ hhmm(post.scheduledAt) }}</span>
      <UIcon :name="TYPE_ICON[post.type]" class="size-3.5 text-[var(--text-muted)]" aria-hidden="true" />
      <span class="text-[13px] text-[var(--text-muted)]">{{ TYPE_LABEL[post.type] }}</span>
    </div>
    <div class="relative rounded-lg overflow-hidden bg-[var(--surface-sunken)]" :style="{ height: `${thumb ?? 132}px` }">
      <img :src="post.cover ?? MEDIA[post.media]" alt="" loading="lazy" class="size-full object-cover">
      <span v-if="showClient !== false" class="absolute left-1.5 bottom-1.5 inline-flex items-center gap-1.5 rounded-md bg-[#242321d9] px-1.5 py-0.5 text-xs font-semibold text-white">
        <span class="size-2 rounded-full" :style="{ background: ws.color }" />{{ ws.short }}
      </span>
    </div>
    <p class="mt-2 px-0.5 text-[13px] leading-snug line-clamp-2">{{ post.caption }}</p>
    <div class="mt-2 px-0.5 flex items-center gap-1 text-xs text-[var(--text-muted)]">
      <UIcon v-for="p in platforms" :key="p" :name="`i-lucide-${p}`" class="size-3.5" aria-hidden="true" />
      <span>{{ n }} destinazioni</span>
    </div>
    <div class="mt-1.5 px-0.5 pb-0.5"><StatusBadge :status="st" plain /></div>
  </NuxtLink>
</template>

/**
 * Client half: terminal-style input history for the Harness composer.
 *
 * Registers one invisible entry into `conversation.input.overlay` (the
 * session-scoped composer seat). The entry attaches a document-level keydown
 * listener: with an empty draft, ArrowUp recalls the previous user message of
 * the current conversation, ArrowDown walks forward, and walking past the
 * newest entry clears the draft. IME composition and non-empty drafts are
 * never intercepted.
 *
 * Data comes from the slot's standard props (`useConversation`,
 * `useInput`, `inputActions`) — the same official face the shipped slash
 * menu uses — so no DOM scraping and no host internals.
 */
window.__ModuleLoader__.load({
  id: '@yafeishi/dsh-composer-history',
  factory(require) {
    const React = require('react')
    const { useEffect, useRef } = React
    const h = React.createElement

    const NS = 'dsh-composer-history'
    const STORE_ENDPOINT = '/api/composer-history'

    const zh = {
      tooltip: '草稿为空时用 ↑/↓ 调取已发送消息',
    }
    const en = {
      tooltip: 'Recall sent messages with ArrowUp/ArrowDown (empty draft)',
    }

    /**
     * Pull the distinct texts of user messages out of a conversation snapshot.
     * Primary path: the chat view snapshot (`views.get('chat')`) holds an
     * ordered key list plus a node store. A generic fallback walk covers
     * snapshot evolution; both fail quietly to an empty history.
     */
    function extractHistory(conversation) {
      const texts = []
      const seen = new Set()
      const push = (text) => {
        text = String(text).trim()
        if (text && !seen.has(text)) {
          seen.add(text)
          texts.push(text)
        }
      }

      const textOf = (node) => {
        let text = ''
        for (const block of node.content) {
          if (typeof block === 'string') text += block
          else if (block && typeof block.text === 'string') text += block.text
        }
        return text
      }

      try {
        const chat = conversation && conversation.views
          && typeof conversation.views.get === 'function'
          ? conversation.views.get('chat')
          : null
        if (chat && Array.isArray(chat.order) && chat.nodes) {
          for (const key of chat.order) {
            let node = null
            try { node = chat.nodes.get(key) } catch { /* store shape change */ }
            if (node && node.kind === 'user' && Array.isArray(node.content)) push(textOf(node))
          }
          if (texts.length) return texts
          // fall through to the generic walk when order/keys yield nothing
        }
      } catch { /* snapshot shape changed */ }

      // Generic fallback: walk known containers depth-limited.
      const visit = (value, depth) => {
        if (value === null || value === undefined || depth > 6 || seen.size > 4000) return
        if (Array.isArray(value)) {
          for (const item of value) visit(item, depth + 1)
          return
        }
        if (typeof value !== 'object') return
        if (value.kind === 'user' && Array.isArray(value.content)) {
          push(textOf(value))
          return
        }
        for (const key of Object.keys(value)) {
          if (key === 'views' || key === 'nodes' || key === 'messages'
            || key === 'items' || key === 'children' || key === 'timeline') {
            visit(value[key], depth + 1)
          }
        }
      }
      try {
        visit(conversation && conversation.views, 0)
      } catch { /* leave history empty */ }
      return texts
    }

    function HistoryHandler(props) {
      const actionsRef = useRef(null)
      const inputRef = useRef(null)
      const conversationRef = useRef(null)
      const idxRef = useRef(null)
      const storeRef = useRef([])          // machine-global sent prompts (Host store)
      const lastRecordedRef = useRef(null) // draftRev already recorded

      actionsRef.current = props && props.inputActions
      try {
        inputRef.current = props && props.useInput ? props.useInput((state) => state) : null
      } catch { /* input state unavailable before binding */ }
      try {
        conversationRef.current = props && props.useConversation
          ? props.useConversation((state) => state)
          : null
      } catch { /* conversation unavailable before binding */ }

      const recordSend = (text) => {
        const trimmed = text.trim()
        if (!trimmed) return
        fetch(STORE_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: trimmed }),
        }).then((response) => {
          if (response.ok) return fetch(STORE_ENDPOINT, { cache: 'no-store' })
          return undefined
        }).then((response) => {
          if (response && response.ok) return response.json()
          return undefined
        }).then((payload) => {
          if (payload && Array.isArray(payload.items)) storeRef.current = payload.items
        }).catch(() => { /* store unreachable; history just stays session-only */ })
      }

      // Record each outgoing message once: while the submit plane is
      // `sending`, the editor still holds the frozen sent draft.
      useEffect(() => {
        const input = inputRef.current
        if (!input || input.phase !== 'sending') return
        if (typeof input.draft !== 'string' || !input.draft.trim()) return
        if (lastRecordedRef.current === input.draftRev) return
        lastRecordedRef.current = input.draftRev
        recordSend(input.draft)
      })

      // Load the machine-global store when this conversation mounts.
      useEffect(() => {
        let cancelled = false
        fetch(STORE_ENDPOINT, { cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : undefined))
          .then((payload) => {
            if (!cancelled && payload && Array.isArray(payload.items)) storeRef.current = payload.items
          })
          .catch(() => { /* store unreachable */ })
        return () => { cancelled = true }
      }, [])

      useEffect(() => {
        const onKeyDown = (event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          if (event.isComposing || event.keyCode === 229) return
          const target = event.target
          if (!target || typeof target.closest !== 'function') return
          if (!target.closest('[contenteditable="true"],textarea')) return

          const actions = actionsRef.current
          if (!actions || typeof actions.setDraft !== 'function') return

          const input = inputRef.current
          const draft = input && typeof input.draft === 'string' ? input.draft : ''

          // Merge: conversation messages first (they are this conversation's
          // own context), then the machine-global store. Dedupe keeps the
          // last occurrence so the walk meets the newest copy.
          const merged = []
          const seen = new Set()
          for (const text of [...storeRef.current, ...extractHistory(conversationRef.current)]) {
            if (seen.has(text)) {
              const at = merged.indexOf(text)
              if (at >= 0) merged.splice(at, 1)
            }
            seen.add(text)
            merged.push(text)
          }
          const history = merged.slice(-500)
          if (!history.length) return

          if (event.key === 'ArrowUp') {
            // Recall starts from an empty draft. While walking, the draft is
            // exactly the recalled entry — keep walking. Any manual edit
            // breaks the walk and hands the caret back.
            const recalling = idxRef.current !== null
            const onRecalledItem = recalling && history[idxRef.current] === draft
            if (draft.trim() !== '' && !onRecalledItem) {
              idxRef.current = null
              return
            }
            const next = idxRef.current === null
              ? history.length - 1
              : Math.max(0, idxRef.current - 1)
            idxRef.current = next
            event.preventDefault()
            actions.setDraft(history[next])
            return
          }

          // ArrowDown: only manage the walk while a recall is in progress.
          if (idxRef.current === null) return
          const next = idxRef.current + 1
          event.preventDefault()
          if (next >= history.length) {
            idxRef.current = null
            actions.setDraft('')
          } else {
            idxRef.current = next
            actions.setDraft(history[next])
          }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
      }, [])

      // Visible status chip (bottom-left): shows how many recalled messages
      // the current conversation exposes. 0 = nothing to recall here.
      const chipCount = extractHistory(conversationRef.current).length

      return h('div', {
        style: {
          position: 'fixed', left: 14, bottom: 14, zIndex: 1100,
          pointerEvents: 'none', userSelect: 'none',
        },
        title: 'Composer history',
      },
        h('span', {
          style: {
            fontSize: 11, padding: '2px 8px', borderRadius: 10,
            background: chipCount > 0 ? 'rgba(47,111,237,0.16)' : 'rgba(128,128,128,0.14)',
            color: chipCount > 0 ? 'var(--dsw-alias-brand-primary, #2F6FED)' : 'var(--dsw-alias-label-secondary, #888)',
          },
        }, '⌃ ' + chipCount))
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), NS + ': locale')
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
          name: 'conversation.input.overlay',
          id: 'composer-history',
          order: 90,
          label: () => t('tooltip'),
          locale: NS,
        }, HistoryHandler)), NS + ': composer overlay')
      },
    }
  },
})

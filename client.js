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

    const zh = {
      tooltip: '草稿为空时用 ↑/↓ 调取已发送消息',
    }
    const en = {
      tooltip: 'Recall sent messages with ArrowUp/ArrowDown (empty draft)',
    }

    const MAX_DEPTH = 6
    const MAX_NODES = 4000

    /**
     * Pull the distinct texts of user messages out of a conversation snapshot.
     * The view-store shape is owner-internal, so this walks the few known
     * containers defensively and gives up quietly when nothing matches; the
     * plugin then simply has no history to recall until the next snapshot.
     */
    function extractHistory(conversation) {
      const texts = []
      const seen = new Set()
      let visited = 0

      const pushUser = (node) => {
        let text = ''
        for (const block of node.content) {
          if (typeof block === 'string') text += block
          else if (block && typeof block.text === 'string') text += block.text
        }
        text = text.trim()
        if (text && !seen.has(text)) {
          seen.add(text)
          texts.push(text)
        }
      }

      const visit = (value, depth) => {
        if (value === null || value === undefined || depth > MAX_DEPTH) return
        if (visited > MAX_NODES) return
        if (Array.isArray(value)) {
          for (const item of value) {
            visited += 1
            visit(item, depth + 1)
          }
          return
        }
        if (typeof value !== 'object') return
        visited += 1
        if (value.kind === 'user' && Array.isArray(value.content)) {
          pushUser(value)
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
        const views = conversation && conversation.views
        if (views) {
          const roots = []
          if (typeof views.get === 'function') {
            for (const name of ['chat', 'conversation', 'default']) {
              try {
                const view = views.get(name)
                if (view) roots.push(view)
              } catch { /* unknown view name */ }
            }
          }
          if (typeof views.grouped === 'function') {
            try {
              const grouped = views.grouped()
              if (grouped) roots.push(grouped)
            } catch { /* no grouped form */ }
          }
          if (!roots.length) roots.push(views)
          for (const root of roots) visit(root, 0)
        }
      } catch { /* snapshot shape changed; leave history empty */ }
      return texts
    }

    function HistoryHandler(props) {
      const actionsRef = useRef(null)
      const inputRef = useRef(null)
      const conversationRef = useRef(null)
      const idxRef = useRef(null)

      actionsRef.current = props && props.inputActions
      try {
        inputRef.current = props && props.useInput ? props.useInput((state) => state) : null
      } catch { /* input state unavailable before binding */ }
      try {
        conversationRef.current = props && props.useConversation
          ? props.useConversation((state) => state)
          : null
      } catch { /* conversation unavailable before binding */ }

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
          const history = extractHistory(conversationRef.current)
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

      return null
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

// A part of the page that fails to draw shows one quiet line instead, and the rest of the board keeps working: one
// malformed change in a board's log once blanked the whole board through the history panel (river0825/unprose#10).
import { Component, type ReactNode } from 'react'

interface Props {
  /** what failed, for the line: "The side panel" */
  what: string
  children: ReactNode
  /** when it changes (another board), the part is tried again */
  resetKey?: unknown
}

export class ErrorBoundary extends Component<Props, { error?: Error }> {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(`${this.props.what} could not be drawn:`, error)
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: undefined })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="part-failed" role="alert">
        {this.props.what} could not be drawn ({this.state.error.message}). The board is fine.{' '}
        <button type="button" className="link-button" onClick={() => this.setState({ error: undefined })}>
          Try again
        </button>
      </div>
    )
  }
}

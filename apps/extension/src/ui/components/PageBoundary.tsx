import { Component, type ReactNode } from 'react';
import { PageHeader } from './ui';

/** Whether the page inside failed to draw. */
interface PageBoundaryState {
  failed: boolean;
}

/**
 * Keeps a page's failure to the page (#497): when the page throws while it draws, such as a live query that failed,
 * its place says *This page couldn't be shown*, while the sidebar, the running job's banner with its Pause, and the
 * dialogs and toasts, which the shell draws outside it, stay. Without it, one page's error left the dashboard blank.
 * The shell gives it a `key` per menu item, so opening another page draws that one afresh. React reports the error in
 * the console, as for any error a boundary catches.
 */
export class PageBoundary extends Component<{ children: ReactNode }, PageBoundaryState> {
  override state: PageBoundaryState = { failed: false };

  /** Any error below marks the page as failed. */
  static getDerivedStateFromError(): PageBoundaryState {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert">
        <PageHeader
          title="This page couldn't be shown"
          description="Something went wrong while drawing it. The menu, and a job that is running, still work: open another page from the menu."
        />
      </div>
    );
  }
}

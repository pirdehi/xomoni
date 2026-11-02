// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Field,
  Meter,
  Modal,
  PageHeader,
  Segmented,
  StatTile,
  Toggle,
  cx,
  useNow,
} from '../../src/ui/components/ui';

describe('cx', () => {
  it('joins the truthy class names and drops the rest', () => {
    expect(cx('a', false, null, undefined, '', 'b')).toBe('a b');
    expect(cx()).toBe('');
  });
});

describe('Card', () => {
  it('shows the title, subtitle, actions and content', () => {
    render(
      <Card title="Limits" subtitle="Per hour" actions={<button type="button">Edit</button>}>
        Body text
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Limits' })).toBeInTheDocument();
    expect(screen.getByText('Per hour')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByText('Body text')).toHaveClass('p-5', 'pt-4');
  });

  it('has no header without a title or actions, and no padding when `padded` is false', () => {
    const { container } = render(
      <Card padded={false} className="extra">
        Table
      </Card>,
    );
    expect(container.querySelector('header')).toBeNull();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByText('Table')).not.toHaveClass('p-5');
    expect(container.querySelector('section')).toHaveClass('extra');
  });

  it('pads the content fully when there is no header', () => {
    render(<Card>Plain</Card>);
    expect(screen.getByText('Plain')).toHaveClass('p-5');
    expect(screen.getByText('Plain')).not.toHaveClass('pt-4');
  });

  it('shows a header for actions alone', () => {
    render(<Card actions={<button type="button">Refresh</button>}>Body</Card>);
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });
});

describe('Button', () => {
  it('is a secondary `type="button"` by default and calls onClick', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveClass('border-line', 'h-9');
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('applies the variant, size and extra classes and renders the icon before the label', () => {
    render(
      <>
        <Button variant="primary" size="sm" className="mine" icon={<svg data-testid="icon" />}>
          Start
        </Button>
        <Button variant="ghost">Later</Button>
        <Button variant="danger">Delete</Button>
      </>,
    );
    const start = screen.getByRole('button', { name: 'Start' });
    expect(start).toHaveClass('bg-accent', 'h-8', 'mine');
    expect(start.firstChild).toBe(screen.getByTestId('icon'));
    expect(screen.getByRole('button', { name: 'Later' })).toHaveClass('text-ink-2');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('bg-critical');
  });

  it('lets `type` be overridden and does not fire when disabled', async () => {
    const onClick = vi.fn();
    render(
      <Button type="submit" disabled onClick={onClick}>
        Send
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('Badge', () => {
  it('pairs a tone dot with its label', () => {
    const { container } = render(<Badge tone="critical">Failed</Badge>);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(container.querySelector('.bg-critical')).not.toBeNull();
  });

  it('uses the neutral dot by default and an icon instead of the dot when given one', () => {
    const { container } = render(
      <>
        <Badge>Ready</Badge>
        <Badge icon={<svg data-testid="badge-icon" />}>Done</Badge>
      </>,
    );
    expect(container.querySelectorAll('.bg-muted')).toHaveLength(1);
    expect(screen.getByTestId('badge-icon')).toBeInTheDocument();
  });
});

describe('StatTile', () => {
  it('shows the label, value and optional line below', () => {
    const { rerender } = render(<StatTile label="Posts" value="1,200" sub="since 2015" icon={<svg />} />);
    expect(screen.getByText('Posts')).toBeInTheDocument();
    expect(screen.getByText('1,200')).toBeInTheDocument();
    expect(screen.getByText('since 2015')).toBeInTheDocument();

    rerender(<StatTile label="Posts" value="1,200" />);
    expect(screen.queryByText('since 2015')).not.toBeInTheDocument();
  });
});

describe('Meter', () => {
  const fill = (name: string) => screen.getByRole('meter', { name }).firstElementChild;

  it('reports its value and fills by the share of the maximum', () => {
    render(<Meter value={5} max={20} label="Deletes today" />);
    const meter = screen.getByRole('meter', { name: 'Deletes today' });
    expect(meter).toHaveAttribute('aria-valuenow', '5');
    expect(meter).toHaveAttribute('aria-valuemax', '20');
    expect(fill('Deletes today')).toHaveStyle({ width: '25%' });
    expect(fill('Deletes today')).toHaveClass('bg-accent');
  });

  it('turns to warn at 80% and to critical when full, never past 100%', () => {
    render(
      <>
        <Meter value={8} max={10} label="Near" />
        <Meter value={15} max={10} label="Over" />
      </>,
    );
    expect(fill('Near')).toHaveClass('bg-warn');
    expect(fill('Over')).toHaveClass('bg-critical');
    expect(fill('Over')).toHaveStyle({ width: '100%' });
  });

  it('stays empty when the maximum is zero', () => {
    render(<Meter value={3} max={0} label="None" />);
    expect(fill('None')).toHaveStyle({ width: '0%' });
    expect(fill('None')).toHaveClass('bg-accent');
  });
});

describe('Field', () => {
  it('labels the control it wraps and shows the hint', () => {
    render(
      <Field label="Keyword" hint="Posts with it are kept">
        <input />
      </Field>,
    );
    expect(screen.getByRole('textbox', { name: /Keyword/ })).toBeInTheDocument();
    expect(screen.getByText('Posts with it are kept')).toBeInTheDocument();
  });

  it('has no hint line without a hint', () => {
    const { container } = render(
      <Field label="Keyword">
        <input />
      </Field>,
    );
    expect(container.querySelectorAll('label > span')).toHaveLength(1);
  });
});

describe('Toggle', () => {
  function Controlled({ disabled = false, onChange }: { disabled?: boolean; onChange?: (v: boolean) => void }) {
    const [on, setOn] = useState(false);
    return (
      <Toggle
        checked={on}
        disabled={disabled}
        onChange={(v) => {
          setOn(v);
          onChange?.(v);
        }}
        label="Notifications"
        description="When a job needs you"
      />
    );
  }

  it('is a switch that flips its checked state', async () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: /Notifications/ });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('When a job needs you')).toBeInTheDocument();

    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('does nothing while disabled', async () => {
    const onChange = vi.fn();
    render(<Controlled disabled onChange={onChange} />);
    const toggle = screen.getByRole('switch', { name: /Notifications/ });
    expect(toggle).toBeDisabled();
    await userEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('has no description line without a description', () => {
    render(<Toggle checked onChange={vi.fn()} label="Active hours" />);
    expect(screen.getByRole('switch', { name: 'Active hours' })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('Segmented', () => {
  it('marks exactly the selected option as pressed and reports a new choice', async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        value="chart"
        onChange={onChange}
        options={[
          { value: 'chart', label: 'Chart' },
          { value: 'table', label: 'Table' },
        ]}
      />,
    );
    expect(screen.getByRole('button', { name: 'Chart', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Table', pressed: false })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    expect(onChange).toHaveBeenCalledWith('table');
  });
});

describe('Modal', () => {
  function renderModal(open = true) {
    const onClose = vi.fn();
    const utils = render(
      <Modal open={open} onClose={onClose} title="Delete 12 posts?" footer={<button type="button">Confirm</button>}>
        This cannot be undone.
      </Modal>,
    );
    return { onClose, ...utils };
  }

  it('renders nothing while closed and ignores Escape', async () => {
    const { onClose } = renderModal(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows a modal dialog with its title, content and footer', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Delete 12 posts?' })).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
  });

  it('has no footer when none is given', () => {
    render(
      <Modal open onClose={vi.fn()} title="Info">
        Text
      </Modal>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('closes on Escape but not on other keys', async () => {
    const { onClose } = renderModal();
    await userEvent.keyboard('{Enter}');
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes from the Close button', async () => {
    const { onClose } = renderModal();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes on a click on the backdrop, not on a click inside the dialog', async () => {
    const { onClose } = renderModal();
    const dialog = screen.getByRole('dialog');
    await userEvent.click(screen.getByText('This cannot be undone.'));
    await userEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    await userEvent.click(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('stops listening for Escape once closed or unmounted', async () => {
    const onClose = vi.fn();
    const { rerender, unmount } = render(
      <Modal open onClose={onClose} title="T">
        Body
      </Modal>,
    );
    rerender(
      <Modal open={false} onClose={onClose} title="T">
        Body
      </Modal>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();

    rerender(
      <Modal open onClose={onClose} title="T">
        Body
      </Modal>,
    );
    unmount();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('EmptyState', () => {
  it('shows the title, body and call to action', () => {
    render(
      <EmptyState
        icon={<svg />}
        title="No open jobs"
        body="Start a cleanup."
        action={<button type="button">New cleanup</button>}
      />,
    );
    expect(screen.getByText('No open jobs')).toBeInTheDocument();
    expect(screen.getByText('Start a cleanup.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New cleanup' })).toBeInTheDocument();
  });

  it('has no call to action without one', () => {
    render(<EmptyState icon={<svg />} title="Nothing" body="Nothing here." />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('Callout', () => {
  it('uses the warn bar by default and shows the title', () => {
    const { container } = render(
      <Callout icon={<svg />} title="Heads up">
        X may limit you.
      </Callout>,
    );
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(screen.getByText('X may limit you.')).toBeInTheDocument();
    expect(container.querySelector('.bg-warn')).not.toBeNull();
  });

  it.each(['neutral', 'accent', 'good', 'serious', 'critical'] as const)('colors the bar for the %s tone', (tone) => {
    const { container } = render(
      <Callout tone={tone} icon={<svg />}>
        Note
      </Callout>,
    );
    expect(container.querySelector(`.bg-${tone === 'neutral' ? 'muted' : tone}`)).not.toBeNull();
    expect(container.querySelector('p')).toBeNull();
  });
});

describe('PageHeader', () => {
  it('shows the title, description and actions', () => {
    render(<PageHeader title="Jobs" description="What Xomoni is doing" actions={<button type="button">New</button>} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Jobs' })).toBeInTheDocument();
    expect(screen.getByText('What Xomoni is doing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });

  it('shows only the title when nothing else is given', () => {
    const { container } = render(<PageHeader title="Settings" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(container.querySelector('p')).toBeNull();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('useNow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function Clock({ every }: { every?: number }) {
    const now = useNow(every);
    return <span data-testid="now">{now}</span>;
  }

  it('re-renders with the current time every interval and stops when unmounted', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { unmount } = render(<Clock every={500} />);
    expect(screen.getByTestId('now')).toHaveTextContent('1000000');

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId('now')).toHaveTextContent('1000500');

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ticks once a second by default', () => {
    vi.useFakeTimers();
    vi.setSystemTime(2_000_000);
    render(<Clock />);
    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(screen.getByTestId('now')).toHaveTextContent('2000000');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('now')).toHaveTextContent('2001000');
  });
});

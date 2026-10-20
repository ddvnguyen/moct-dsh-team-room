// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { StatusPicker } from '../../src/client/multica-ui/StatusPicker.tsx'
import { PriorityPicker } from '../../src/client/multica-ui/PriorityPicker.tsx'
import { AssigneePicker } from '../../src/client/multica-ui/AssigneePicker.tsx'

afterEach(() => { cleanup() })

const t = ((key: string, args?: Record<string, string>) => args === undefined
  ? key
  : Object.entries(args).reduce((text, [name, value]) => text.replace(`{${name}}`, value), key)) as never

// The trigger's name is "<field label>: <current value>", so match on the field label.
const trigger = (label: string) => {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`)
  if (button === null) throw new Error(`missing trigger ${label}`)
  return button
}

const rows = () => [...document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]

describe('Status picker', () => {
  it('offers all five statuses and disables the two claim-driven ones', () => {
    const onChange = vi.fn()
    render(<StatusPicker status="todo" onChange={onChange} t={t} />)
    fireEvent.click(trigger('statusPickerLabel'))
    const items = rows()
    expect(items).toHaveLength(5)
    expect(items.map(item => item.textContent)).toEqual([
      'statusTodo', 'statusInProgress', 'statusInReview', 'statusDone', 'statusClosed',
    ])
    expect(items[1]?.disabled).toBe(true)
    expect(items[2]?.disabled).toBe(true)
    expect(items[0]?.disabled).toBe(false)
  })

  it('emits only a human target, and never the current status', () => {
    const onChange = vi.fn()
    render(<StatusPicker status="todo" onChange={onChange} t={t} />)
    fireEvent.click(trigger('statusPickerLabel'))
    fireEvent.click(rows()[1]!)
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(rows()[3]!)
    expect(onChange).toHaveBeenCalledWith('done')
  })

  it('walks past disabled rows with the arrow keys', () => {
    render(<StatusPicker status="todo" onChange={() => {}} t={t} />)
    fireEvent.click(trigger('statusPickerLabel'))
    expect(document.activeElement).toBe(rows()[0])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows()[3])
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(rows()[4])
  })

  it('names the trigger for assistive technology', () => {
    render(<StatusPicker status="todo" onChange={() => {}} t={t} />)
    expect(trigger('statusPickerLabel').getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger('statusPickerLabel').getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps the current value in the trigger name, and marks the open state and the selected row', () => {
    render(<StatusPicker status="done" onChange={() => {}} t={t} />)
    expect(trigger('statusPickerLabel').getAttribute('aria-label')).toBe('statusPickerLabel: statusDone')
    fireEvent.click(trigger('statusPickerLabel'))
    expect(trigger('statusPickerLabel').getAttribute('aria-expanded')).toBe('true')
    expect(rows().filter(row => row.getAttribute('aria-current') === 'true').map(row => row.textContent)).toEqual(['statusDone'])
  })

  it('points each disabled row at the one visible hint', () => {
    render(<StatusPicker status="todo" onChange={() => {}} t={t} />)
    fireEvent.click(trigger('statusPickerLabel'))
    const hint = document.getElementById(rows()[1]!.getAttribute('aria-describedby')!)
    expect(hint?.textContent).toBe('statusPickerLocked')
    expect(rows()[2]!.getAttribute('aria-describedby')).toBe(hint?.id)
    expect(rows()[0]!.hasAttribute('aria-describedby')).toBe(false)
  })

  it('closes on Escape and returns focus to the trigger', () => {
    render(<StatusPicker status="todo" onChange={() => {}} t={t} />)
    const button = trigger('statusPickerLabel')
    button.focus()
    fireEvent.click(button)
    expect(rows().length).toBeGreaterThan(0)
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(rows()).toHaveLength(0)
    expect(trigger('statusPickerLabel').getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trigger('statusPickerLabel'))
  })

  it('renders its list outside the trigger subtree so a clipping ancestor cannot crop it', () => {
    const { container } = render(<div style={{ overflow: 'hidden' }}><StatusPicker status="todo" onChange={() => {}} t={t} /></div>)
    fireEvent.click(trigger('statusPickerLabel'))
    expect(rows().length).toBe(5)
    expect(rows().every(row => !container.contains(row))).toBe(true)
  })

  it('keeps a trigger click and a row pick from reaching a clickable ancestor', () => {
    const onCard = vi.fn()
    render(<div role="presentation" onClick={onCard}><StatusPicker status="todo" onChange={() => {}} t={t} /></div>)
    fireEvent.click(trigger('statusPickerLabel'))
    fireEvent.click(rows()[3]!)
    expect(onCard).not.toHaveBeenCalled()
  })
})

describe('Priority picker', () => {
  it('leads with the empty value and emits the chosen severity', () => {
    const onChange = vi.fn()
    render(<PriorityPicker priority="none" onChange={onChange} t={t} />)
    fireEvent.click(trigger('priorityPickerLabel'))
    expect(rows().map(row => row.textContent)).toEqual([
      'priorityNone', 'priorityUrgent', 'priorityHigh', 'priorityMedium', 'priorityLow',
    ])
    fireEvent.click(rows()[2]!)
    expect(onChange).toHaveBeenCalledWith('high')
  })

  it('does not re-emit the current priority', () => {
    const onChange = vi.fn()
    render(<PriorityPicker priority="high" onChange={onChange} t={t} />)
    fireEvent.click(trigger('priorityPickerLabel'))
    fireEvent.click(rows()[2]!)
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('Assignee picker', () => {
  const members = [
    { memberId: 'member:a', handle: '@ada' },
    { memberId: 'member:b', handle: '@builder' },
  ]

  it('pins Unassigned first and clears the field with null', () => {
    const onChange = vi.fn()
    render(<AssigneePicker assignee="member:b" members={members} onChange={onChange} t={t} />)
    fireEvent.click(trigger('assigneePickerLabel'))
    expect(rows()[0]?.textContent).toContain('assigneeUnassigned')
    fireEvent.click(rows()[0]!)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('emits the chosen member id', () => {
    const onChange = vi.fn()
    render(<AssigneePicker assignee={null} members={members} onChange={onChange} t={t} />)
    fireEvent.click(trigger('assigneePickerLabel'))
    fireEvent.click(rows()[2]!)
    expect(onChange).toHaveBeenCalledWith('member:b')
  })

  it('shows an assignee the roster no longer lists instead of Unassigned', () => {
    render(<AssigneePicker assignee="member:gone" members={members} onChange={() => {}} t={t} />)
    expect(trigger('assigneePickerLabel').getAttribute('aria-label')).toBe('assigneePickerLabel: member:gone')
    expect(trigger('assigneePickerLabel').textContent).toContain('member:gone')
    fireEvent.click(trigger('assigneePickerLabel'))
    expect(rows().filter(row => row.getAttribute('aria-current') === 'true')).toHaveLength(0)
  })

  it('shows the assigned handle on the trigger', () => {
    render(<AssigneePicker assignee="member:a" members={members} onChange={() => {}} t={t} />)
    expect(trigger('assigneePickerLabel').textContent).toContain('@ada')
  })
})

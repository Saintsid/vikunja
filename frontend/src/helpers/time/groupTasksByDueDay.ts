import {parseDateOrNull} from '@/helpers/parseDateOrNull'
import {MILLISECONDS_A_DAY} from '@/constants/date'

export type DueDayGroupKind = 'overdue' | 'earlier' | 'today' | 'tomorrow' | 'day' | 'later' | 'noDueDate'

export interface DueDayGroup<T> {
	key: string
	kind: DueDayGroupKind
	// A moment on the group's day, only set for `day` groups which are titled by their date.
	day: Date | null
	tasks: T[]
}

// Days after today that get a group of their own. Anything further out is "later".
export const DUE_DAY_GROUP_LAST_DAY = 6

/**
 * Returns the zone when the runtime knows it, otherwise undefined so Intl uses the browser's zone.
 * The user's settings can hold an empty or unknown zone.
 */
export function resolveTimeZone(timeZone: string | null | undefined): string | undefined {
	if (!timeZone) {
		return undefined
	}

	try {
		new Intl.DateTimeFormat('en-US', {timeZone})
		return timeZone
	} catch {
		return undefined
	}
}

function createDayNumber(timeZone: string | undefined) {
	const formatter = new Intl.DateTimeFormat('en-US', {timeZone, year: 'numeric', month: 'numeric', day: 'numeric'})

	return (date: Date): number => {
		const parts: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {}
		for (const {type, value} of formatter.formatToParts(date)) {
			parts[type] = Number(value)
		}
		// Counting the calendar date as a UTC day keeps DST shifts out of the difference between two days.
		return Date.UTC(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1) / MILLISECONDS_A_DAY
	}
}

function classify(daysFromToday: number): Pick<DueDayGroup<unknown>, 'key' | 'kind'> {
	if (daysFromToday === 0) {
		return {key: 'today', kind: 'today'}
	}
	if (daysFromToday === 1) {
		return {key: 'tomorrow', kind: 'tomorrow'}
	}
	if (daysFromToday <= DUE_DAY_GROUP_LAST_DAY) {
		return {key: `day-${daysFromToday}`, kind: 'day'}
	}
	return {key: 'later', kind: 'later'}
}

/**
 * Splits tasks into overdue, earlier (done tasks due before today), today, tomorrow, one group per
 * day up to DUE_DAY_GROUP_LAST_DAY days from today, later and no due date. Days are calendar days
 * in `timeZone`. Groups come back in that order, empty ones are left out. Tasks within a group are
 * sorted by due date, earliest first; tasks with equal due dates and those without one keep their order.
 */
export function groupTasksByDueDay<T extends {due_date?: string | null, done?: boolean | null}>(
	tasks: readonly T[],
	now: Date,
	timeZone?: string | null,
): DueDayGroup<T>[] {
	const dayNumber = createDayNumber(resolveTimeZone(timeZone))
	const today = dayNumber(now)

	const dated: {task: T, due: Date}[] = []
	const undated: T[] = []
	for (const task of tasks) {
		const due = parseDateOrNull(task.due_date)
		if (due === null) {
			undated.push(task)
		} else {
			dated.push({task, due})
		}
	}

	dated.sort((a, b) => a.due.getTime() - b.due.getTime())

	const overdue: T[] = []
	const earlier: T[] = []
	// From today on the calendar day only grows with the due date, so every group is one run.
	const upcoming: DueDayGroup<T>[] = []
	for (const {task, due} of dated) {
		const daysFromToday = dayNumber(due) - today
		if (daysFromToday < 0) {
			// A done task is not overdue
			if (task.done) {
				earlier.push(task)
			} else {
				overdue.push(task)
			}
			continue
		}

		const {key, kind} = classify(daysFromToday)
		let group = upcoming.at(-1)
		if (group?.key !== key) {
			group = {key, kind, day: kind === 'day' ? due : null, tasks: []}
			upcoming.push(group)
		}
		group.tasks.push(task)
	}

	const groups: DueDayGroup<T>[] = [
		{key: 'overdue', kind: 'overdue', day: null, tasks: overdue},
		{key: 'earlier', kind: 'earlier', day: null, tasks: earlier},
		...upcoming,
		{key: 'noDueDate', kind: 'noDueDate', day: null, tasks: undated},
	]

	return groups.filter(group => group.tasks.length > 0)
}

/**
 * Titles a day group like "Tue 13.10": the short weekday in `locale` and day.month, both in `timeZone`.
 */
export function formatDueDayTitle(day: Date, locale: string, timeZone?: string | null): string {
	const zone = resolveTimeZone(timeZone)
	const weekday = new Intl.DateTimeFormat(locale, {weekday: 'short', timeZone: zone}).format(day)
	const parts = new Intl.DateTimeFormat('en-US', {day: '2-digit', month: '2-digit', timeZone: zone}).formatToParts(day)
	const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? ''

	return `${weekday.charAt(0).toLocaleUpperCase(locale)}${weekday.slice(1)} ${part('day')}.${part('month')}`
}

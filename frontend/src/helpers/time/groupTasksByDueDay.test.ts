import {describe, it, expect} from 'vitest'

import {formatDueDayTitle, groupTasksByDueDay, resolveTimeZone} from './groupTasksByDueDay'

type TestTask = {id: number, due_date?: string | null, done?: boolean}

// Saturday, 10 October 2026
const NOW = new Date('2026-10-10T12:00:00Z')

function task(id: number, due_date?: string | null, done = false): TestTask {
	return {id, due_date, done}
}

function summary(tasks: TestTask[], now = NOW, timeZone: string | null | undefined = 'UTC') {
	return groupTasksByDueDay(tasks, now, timeZone).map(g => ({key: g.key, ids: g.tasks.map(t => t.id)}))
}

describe('groupTasksByDueDay', () => {
	it('returns no groups for no tasks', () => {
		expect(groupTasksByDueDay([], NOW, 'UTC')).toEqual([])
	})

	it('orders the groups and leaves out empty ones', () => {
		expect(summary([
			task(1),
			task(2, '2026-10-20T09:00:00Z'),
			task(3, '2026-10-13T09:00:00Z'),
			task(4, '2026-10-11T09:00:00Z'),
			task(5, '2026-10-10T09:00:00Z'),
			task(6, '2026-10-01T09:00:00Z'),
		])).toEqual([
			{key: 'overdue', ids: [6]},
			{key: 'today', ids: [5]},
			{key: 'tomorrow', ids: [4]},
			{key: 'day-3', ids: [3]},
			{key: 'later', ids: [2]},
			{key: 'noDueDate', ids: [1]},
		])
	})

	it('gives each of the days two to six from today its own group', () => {
		const groups = groupTasksByDueDay([
			task(2, '2026-10-12T09:00:00Z'),
			task(3, '2026-10-13T09:00:00Z'),
			task(4, '2026-10-14T09:00:00Z'),
			task(5, '2026-10-15T09:00:00Z'),
			task(6, '2026-10-16T09:00:00Z'),
		], NOW, 'UTC')

		expect(groups.map(g => [g.key, g.kind])).toEqual([
			['day-2', 'day'],
			['day-3', 'day'],
			['day-4', 'day'],
			['day-5', 'day'],
			['day-6', 'day'],
		])
		expect(groups[1].day).toEqual(new Date('2026-10-13T09:00:00Z'))
	})

	it('only sets the day on day groups', () => {
		const groups = groupTasksByDueDay([task(1, '2026-10-09T09:00:00Z'), task(2, '2026-10-10T09:00:00Z'), task(3)], NOW, 'UTC')

		expect(groups.map(g => g.day)).toEqual([null, null, null])
	})

	describe('day boundaries', () => {
		it('puts the last moment of yesterday into overdue', () => {
			expect(summary([task(1, '2026-10-09T23:59:59.999Z')])).toEqual([{key: 'overdue', ids: [1]}])
		})

		it('puts the first and the last moment of today into today', () => {
			expect(summary([task(1, '2026-10-10T00:00:00Z'), task(2, '2026-10-10T23:59:59.999Z')]))
				.toEqual([{key: 'today', ids: [1, 2]}])
		})

		it('keeps a task due earlier today in today, not in overdue', () => {
			expect(summary([task(1, '2026-10-10T08:00:00Z')])).toEqual([{key: 'today', ids: [1]}])
		})

		it('puts midnight into tomorrow', () => {
			expect(summary([task(1, '2026-10-11T00:00:00Z')])).toEqual([{key: 'tomorrow', ids: [1]}])
		})

		it('puts the end of day six into its own group and the start of day seven into later', () => {
			expect(summary([task(1, '2026-10-16T23:59:59.999Z'), task(2, '2026-10-17T00:00:00Z')])).toEqual([
				{key: 'day-6', ids: [1]},
				{key: 'later', ids: [2]},
			])
		})
	})

	describe('overdue', () => {
		it('collects every task due before today, earliest first', () => {
			expect(summary([
				task(1, '2026-10-09T10:00:00Z'),
				task(2, '2025-01-01T10:00:00Z'),
				task(3, '2026-10-03T10:00:00Z'),
			])).toEqual([{key: 'overdue', ids: [2, 3, 1]}])
		})
	})

	describe('done tasks', () => {
		it('puts done tasks due before today into earlier instead of overdue', () => {
			expect(summary([
				task(1, '2026-10-09T08:00:00Z', true),
				task(2, '2026-10-09T09:00:00Z'),
				task(3, '2026-10-09T10:00:00Z', true),
				task(4, '2026-10-08T10:00:00Z'),
			])).toEqual([
				{key: 'overdue', ids: [4, 2]},
				{key: 'earlier', ids: [1, 3]},
			])
		})

		it('keeps done tasks due today or later in their day', () => {
			expect(summary([task(1, '2026-10-10T08:00:00Z', true), task(2, '2026-10-13T08:00:00Z', true)])).toEqual([
				{key: 'today', ids: [1]},
				{key: 'day-3', ids: [2]},
			])
		})
	})

	describe('no due date', () => {
		it.each([
			['missing', undefined],
			['null', null],
			['empty', ''],
			['the api zero time', '0001-01-01T00:00:00Z'],
			['invalid', 'not a date'],
		])('treats a %s due date as no due date', (_, dueDate) => {
			expect(summary([task(1, dueDate)])).toEqual([{key: 'noDueDate', ids: [1]}])
		})

		it('keeps tasks without a due date in their order and last', () => {
			expect(summary([task(3), task(1, '2026-10-10T09:00:00Z'), task(2), task(4)])).toEqual([
				{key: 'today', ids: [1]},
				{key: 'noDueDate', ids: [3, 2, 4]},
			])
		})
	})

	describe('order within a group', () => {
		it('sorts by due date, earliest first', () => {
			expect(summary([
				task(1, '2026-10-10T18:00:00Z'),
				task(2, '2026-10-10T07:00:00Z'),
				task(3, '2026-10-10T12:30:00Z'),
			])).toEqual([{key: 'today', ids: [2, 3, 1]}])
		})

		it('keeps the order of tasks with the same due date', () => {
			expect(summary([
				task(3, '2026-10-13T09:00:00Z'),
				task(1, '2026-10-13T09:00:00Z'),
				task(2, '2026-10-13T09:00:00Z'),
			])).toEqual([{key: 'day-3', ids: [3, 1, 2]}])
		})

		it('does not change the passed array', () => {
			const tasks = [task(1, '2026-10-12T09:00:00Z'), task(2, '2026-10-10T09:00:00Z')]
			groupTasksByDueDay(tasks, NOW, 'UTC')
			expect(tasks.map(t => t.id)).toEqual([1, 2])
		})
	})

	describe('time zone', () => {
		// 22:30 UTC is already 01:30 the next day in Moscow (UTC+3)
		const lateEvening = '2026-10-10T22:30:00Z'

		it('uses the calendar date in the given zone for the task', () => {
			expect(summary([task(1, lateEvening)], NOW, 'UTC')).toEqual([{key: 'today', ids: [1]}])
			expect(summary([task(1, lateEvening)], NOW, 'Europe/Moscow')).toEqual([{key: 'tomorrow', ids: [1]}])
		})

		it('uses the calendar date in the given zone for today', () => {
			const now = new Date(lateEvening)
			const dueTomorrowMorningInMoscow = task(1, '2026-10-11T08:00:00+03:00')

			expect(summary([dueTomorrowMorningInMoscow], now, 'UTC')).toEqual([{key: 'tomorrow', ids: [1]}])
			expect(summary([dueTomorrowMorningInMoscow], now, 'Europe/Moscow')).toEqual([{key: 'today', ids: [1]}])
		})

		it('works for zones behind UTC', () => {
			// 02:00 UTC on the 10th is still 22:00 on the 9th in New York (UTC-4)
			const now = new Date('2026-10-10T02:00:00Z')
			const dueEveningOfThe9th = task(1, '2026-10-09T23:30:00Z')

			expect(summary([dueEveningOfThe9th], now, 'UTC')).toEqual([{key: 'overdue', ids: [1]}])
			expect(summary([dueEveningOfThe9th], now, 'America/New_York')).toEqual([{key: 'today', ids: [1]}])
		})

		it('counts days correctly across the end of daylight saving time', () => {
			// Berlin switches from UTC+2 to UTC+1 in the night to Sunday, 25 October 2026.
			const now = new Date('2026-10-24T10:00:00Z')

			expect(summary([
				task(1, '2026-10-25T22:59:59Z'), // Sunday 23:59:59 CET
				task(2, '2026-10-25T23:00:00Z'), // Monday 00:00 CET
			], now, 'Europe/Berlin')).toEqual([
				{key: 'tomorrow', ids: [1]},
				{key: 'day-2', ids: [2]},
			])
		})

		it.each(['', null, undefined, 'Not/A_Zone'])('falls back to the browser zone for %j', (timeZone) => {
			const tasks = [task(1, '2026-10-09T23:30:00Z'), task(2, '2026-10-10T23:30:00Z'), task(3, '2026-10-11T23:30:00Z')]
			const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone

			expect(groupTasksByDueDay(tasks, NOW, timeZone)).toEqual(groupTasksByDueDay(tasks, NOW, browserZone))
		})
	})
})

describe('resolveTimeZone', () => {
	it('keeps a known zone', () => {
		expect(resolveTimeZone('Europe/Moscow')).toBe('Europe/Moscow')
	})

	it.each(['', null, undefined, 'Not/A_Zone'])('returns undefined for %j', (timeZone) => {
		expect(resolveTimeZone(timeZone)).toBeUndefined()
	})
})

describe('formatDueDayTitle', () => {
	const tuesday = new Date('2026-10-13T12:00:00Z')

	it('capitalizes the short weekday and adds day.month', () => {
		expect(formatDueDayTitle(tuesday, 'ru-RU', 'Europe/Moscow')).toBe('Вт 13.10')
		expect(formatDueDayTitle(tuesday, 'en', 'Europe/Moscow')).toBe('Tue 13.10')
	})

	it('pads day and month', () => {
		expect(formatDueDayTitle(new Date('2026-03-05T12:00:00Z'), 'en', 'UTC')).toBe('Thu 05.03')
	})

	it('uses the date in the given zone', () => {
		const lateTuesdayUtc = new Date('2026-10-13T22:30:00Z')

		expect(formatDueDayTitle(lateTuesdayUtc, 'ru-RU', 'UTC')).toBe('Вт 13.10')
		expect(formatDueDayTitle(lateTuesdayUtc, 'ru-RU', 'Europe/Moscow')).toBe('Ср 14.10')
	})
})

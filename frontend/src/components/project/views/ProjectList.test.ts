import {shallowMount, flushPromises, enableAutoUnmount} from '@vue/test-utils'
import {describe, expect, it, vi, beforeEach, afterEach} from 'vitest'
import {QueryClient, VueQueryPlugin} from '@tanstack/vue-query'
import {defineComponent, h, nextTick, type Component} from 'vue'
import {createRouter, createMemoryHistory} from 'vue-router'
import {createPinia} from 'pinia'
import draggable from 'zhyswan-vuedraggable'

import type {Task as ITask} from '@/client/generated'

const sdk = vi.hoisted(() => ({
	tasksPositionUpdate: vi.fn(),
	projectViewTasksList: vi.fn(),
}))
const {tasksPositionUpdate: updatePosition} = sdk

vi.mock('@/client/generated', () => sdk)
vi.mock('@/stores/auth', () => ({useAuthStore: () => ({settings: {timezone: 'UTC'}})}))
vi.mock('@/message', () => ({error: vi.fn()}))
vi.mock('@/composables/useTaskDragToProject', () => ({
	useTaskDragToProject: () => ({
		handleTaskDropToProject: async () => ({moved: false, targetProjectId: null}),
	}),
}))

vi.mock('@/stores/base', () => ({
	useBaseStore: () => ({setHasTasks: vi.fn()}),
}))

vi.mock('@/composables/useCurrentProject', () => ({
	useCurrentProject: () => ({
		currentProject: {value: {id: 1, max_permission: 2}},
		isPending: {value: false},
	}),
}))

vi.mock('vue-i18n', async importOriginal => ({
	...await importOriginal<typeof import('vue-i18n')>(),
	useI18n: () => ({t: (key: string) => key, locale: {value: 'en'}}),
}))

// Saturday, 10 October 2026
vi.mock('@/composables/useGlobalNow', () => ({
	useGlobalNow: () => ({now: {value: new Date('2026-10-10T12:00:00Z')}, update: () => {}}),
}))

import ProjectList from './ProjectList.vue'

// Mounted lists listen for keyboard navigation on the document.
enableAutoUnmount(afterEach)

function makeTask(id: number, position: number, dueDate?: string): ITask {
	return {id, title: `Task ${id}`, position, due_date: dueDate} as ITask
}

async function mountList(query: Record<string, string> = {}, stubs: Record<string, Component> = {}) {
	const router = createRouter({history: createMemoryHistory(), routes: [{path: '/', component: {render: () => null}}]})
	await router.push({path: '/', query})
	const wrapper = shallowMount(ProjectList, {
		props: {
			isLoadingProject: false,
			projectId: 1,
			viewId: 10,
		},
		global: {
			plugins: [
				router,
				createPinia(),
				[VueQueryPlugin, {queryClient: new QueryClient({defaultOptions: {queries: {retry: false}}})}],
			],
			mocks: {$t: (key: string) => key},
			stubs: {
				ProjectWrapper: {template: '<div><slot name="default"/></div>'},
				...stubs,
			},
		},
	})

	await flushPromises()

	return wrapper
}

function dragEndEvent(taskId: string, newIndex: number) {
	const item = document.createElement('li')
	item.dataset.taskId = taskId
	const list = document.createElement('ul')
	return {item, to: list, from: list, newIndex}
}

describe('ProjectList', () => {
	beforeEach(() => {
		updatePosition.mockReset()
		updatePosition.mockResolvedValue({data: {position: 200}})
		// Asymmetric positions: the midpoint between the neighbours must differ from the dragged task's own position.
		sdk.projectViewTasksList.mockResolvedValue({
			data: {
				items: [makeTask(1, 100), makeTask(2, 250), makeTask(3, 300)],
				page: 1,
				total_pages: 1,
			},
		})
	})

	it('saves the position of the dropped task', async () => {
		const wrapper = await mountList()

		// The DOM index sortable reports can point past the last task
		wrapper.findComponent(draggable).vm.$emit('end', dragEndEvent('2', 42))
		await flushPromises()

		expect(updatePosition).toHaveBeenCalledWith(expect.objectContaining({
			path: {task: 2},
			body: {position: 200, project_view_id: 10},
		}))
	})

	it('saves the position of a task reordered between two others', async () => {
		const wrapper = await mountList()
		const list = wrapper.findComponent(draggable)

		list.vm.$emit('update:modelValue', [makeTask(1, 100), makeTask(3, 300), makeTask(2, 250)])
		await nextTick()
		list.vm.$emit('end', dragEndEvent('3', 1))
		await flushPromises()

		expect(updatePosition).toHaveBeenCalledWith(expect.objectContaining({
			path: {task: 3},
			body: {position: 175, project_view_id: 10},
		}))
	})

	it('does nothing when the dropped task is gone', async () => {
		const wrapper = await mountList()

		wrapper.findComponent(draggable).vm.$emit('end', dragEndEvent('404', 0))
		await flushPromises()

		expect(updatePosition).not.toHaveBeenCalled()
	})
})

describe('ProjectList grouped by due day', () => {
	const focused: number[] = []
	const SingleTaskStub = defineComponent({
		name: 'SingleTaskInProject',
		props: {theTask: {type: Object, required: true}},
		setup(props, {expose}) {
			expose({focus: () => focused.push((props.theTask as ITask).id!), click: () => {}})
			return () => h('div', {'data-task-id': (props.theTask as ITask).id})
		},
	})

	beforeEach(() => {
		focused.length = 0
		localStorage.clear()
		sdk.projectViewTasksList.mockResolvedValue({
			data: {
				items: [
					makeTask(1, 100),
					makeTask(2, 200, '2026-10-20T09:00:00Z'),
					makeTask(3, 300, '2026-10-13T09:00:00Z'),
					makeTask(4, 400, '2026-10-11T09:00:00Z'),
					makeTask(5, 500, '2026-10-10T18:00:00Z'),
					makeTask(6, 600, '2026-10-10T08:00:00Z'),
					makeTask(7, 700, '2026-10-01T09:00:00Z'),
				],
				page: 1,
				total_pages: 1,
			},
		})
	})

	afterEach(() => {
		localStorage.clear()
	})

	it('asks the api for the earliest due date first', async () => {
		await mountList({sort: 'due_date_week:asc'})

		const {query} = sdk.projectViewTasksList.mock.lastCall![0] as {query: Record<string, unknown>}
		expect(query.sort_by).toEqual(['due_date'])
		expect(query.order_by).toEqual(['asc'])
	})

	it('shows the tasks in titled groups without the drag and drop list', async () => {
		const wrapper = await mountList({sort: 'due_date_week:asc'}, {SingleTaskInProject: SingleTaskStub})

		expect(wrapper.findComponent(draggable).exists()).toBe(false)
		expect(wrapper.findAll('.due-day-group__title').map(title => title.text())).toEqual([
			'project.list.dueGroups.overdue',
			'input.datepicker.today',
			'input.datepicker.tomorrow',
			'Tue 13.10',
			'project.list.dueGroups.later',
			'project.list.dueGroups.noDueDate',
		])
		expect(wrapper.findAll('.due-day-group').map(group => group.findAll('[data-task-id]').map(task => task.attributes('data-task-id'))))
			.toEqual([['7'], ['6', '5'], ['4'], ['3'], ['2'], ['1']])
	})

	it('moves through the groups with j in the order they are shown', async () => {
		await mountList({sort: 'due_date_week:asc'}, {SingleTaskInProject: SingleTaskStub})

		for (let i = 0; i < 8; i++) {
			document.dispatchEvent(new KeyboardEvent('keydown', {code: 'KeyJ'}))
		}

		expect(focused).toEqual([7, 6, 5, 4, 3, 2, 1, 1])
	})

	it('keeps the flat list for other sorts', async () => {
		const wrapper = await mountList({sort: 'due_date:asc'})

		expect(wrapper.findComponent(draggable).exists()).toBe(true)
		expect(wrapper.find('.due-day-group').exists()).toBe(false)
	})
})

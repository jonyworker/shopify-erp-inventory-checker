import { nextTick, ref } from 'vue'

export function useCompareResultScroll() {
    const summarySection = ref(null)

    async function scrollToSummary(options = {}) {
        const {
            behavior = 'smooth',
            block = 'start'
        } = options

        await nextTick()

        if (!summarySection.value) {
            return
        }

        summarySection.value.scrollIntoView({
            behavior,
            block
        })
    }

    return {
        summarySection,
        scrollToSummary
    }
}
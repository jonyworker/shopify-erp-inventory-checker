import { ref } from 'vue'
import { supabase } from '@/lib/supabaseClient'

export const currentUser = ref(null)
export const isAuthReady = ref(false)

export async function initializeAuth() {
    const {
        data: { session }
    } = await supabase.auth.getSession()

    currentUser.value = session?.user ?? null
    isAuthReady.value = true

    supabase.auth.onAuthStateChange((_event, session) => {
        currentUser.value = session?.user ?? null
    })
}
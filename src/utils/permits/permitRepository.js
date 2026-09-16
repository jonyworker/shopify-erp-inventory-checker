import { supabase } from '@/lib/supabaseClient'

export async function getPermits() {
    const { data, error } = await supabase
        .from('permits')
        .select('*')
        .order('created_at', {
            ascending: false
        })

    if (error) {
        throw error
    }

    return data
}

export async function createPermit(permitData) {
    const payload = {
        application_no: permitData.applicationNo,
        certificate_no: permitData.certificateNo,
        issue_date: permitData.issueDate,
        expiration_date: permitData.expirationDate,
        goods_type: permitData.goodsType,
        applicant: permitData.applicant
    }

    const { data, error } = await supabase
        .from('permits')
        .insert(payload)
        .select()
        .single()

    if (error) {
        throw error
    }

    return data
}

export async function createPermitItems(
    permitId,
    items
) {
    const payload = items.map((item) => ({
        permit_id: permitId,
        item_no: item.itemNo,
        ccc_code: item.cccCode,
        country: item.country,
        brand: item.brand,
        goods_name: item.goodsName,
        model: item.model,
        review_result: item.reviewResult
    }))

    const { data, error } = await supabase
        .from('permit_items')
        .insert(payload)
        .select()

    if (error) {
        throw error
    }

    return data
}

export async function createPermitWithItems(permitData) {
    const { data, error } = await supabase.rpc(
        'create_permit_with_items',
        {
            p_application_no: permitData.applicationNo,
            p_certificate_no: permitData.certificateNo,
            p_issue_date: permitData.issueDate,
            p_expiration_date: permitData.expirationDate,
            p_goods_type: permitData.goodsType,
            p_applicant: permitData.applicant,
            p_items: permitData.items
        }
    )

    if (error) {
        throw error
    }

    return data
}
import { supabase } from '@/lib/supabaseClient'


// =========================================================
// Constants
// =========================================================

export const GUN_COMPONENT_TYPES = [
	'chamber',
	'barrel',
	'magazine_top',
	'slide_internal',
	'bolt'
]


const PRODUCT_ASSET_BUCKET =
	'product-assets'


const SIGNED_URL_EXPIRES_IN =
	60 * 60


// =========================================================
// Get Products
// =========================================================

export async function getProducts() {
	const { data, error } = await supabase
		.from('products')
		.select('*')
		.order(
			'created_at',
			{
				ascending: false
			}
		)

	if (error) {
		throw error
	}

	return data ?? []
}


// =========================================================
// Create Product
// =========================================================

export async function createProduct(
	productData
) {
	const payload =
		buildProductPayload(
			productData
		)

	const { data, error } = await supabase
		.from('products')
		.insert(payload)
		.select()
		.single()

	if (error) {
		throw error
	}

	return data
}


// =========================================================
// Update Product
// =========================================================

export async function updateProduct(
	productId,
	productData
) {
	const payload =
		buildProductPayload(
			productData
		)

	const { data, error } = await supabase
		.from('products')
		.update(payload)
		.eq(
			'id',
			productId
		)
		.select()
		.single()

	if (error) {
		throw error
	}

	return data
}


// =========================================================
// Active Status
// =========================================================

export async function updateProductActiveStatus(
	productId,
	isActive
) {
	const { data, error } = await supabase
		.from('products')
		.update({
			is_active: isActive
		})
		.eq(
			'id',
			productId
		)
		.select()
		.single()

	if (error) {
		throw error
	}

	return data
}


// =========================================================
// Component Specs
// =========================================================

export async function getProductComponentSpecs(
	productId
) {
	const { data, error } = await supabase
		.from('product_component_specs')
		.select('*')
		.eq(
			'product_id',
			productId
		)

	if (error) {
		throw error
	}

	return data ?? []
}


export async function saveProductComponentSpecs(
	productId,
	componentSpecs
) {
	const rows =
		GUN_COMPONENT_TYPES.map(
			componentType => {
				const spec =
					componentSpecs[
						componentType
						]

				return {
					product_id:
					productId,

					component_type:
					componentType,

					is_metal:
						spec?.isMetal ?? null,

					note:
						spec?.note?.trim() ||
						null
				}
			}
		)


	const { data, error } = await supabase
		.from('product_component_specs')
		.upsert(
			rows,
			{
				onConflict:
					'product_id,component_type'
			}
		)
		.select()

	if (error) {
		throw error
	}

	return data ?? []
}


export async function deleteProductComponentSpecs(
	productId
) {
	const { error } = await supabase
		.from('product_component_specs')
		.delete()
		.eq(
			'product_id',
			productId
		)

	if (error) {
		throw error
	}
}


// =========================================================
// Product Assets
// =========================================================

export async function getProductAssets(
	productId
) {
	const { data, error } = await supabase
		.from('product_assets')
		.select('*')
		.eq(
			'product_id',
			productId
		)
		.order(
			'asset_type',
			{
				ascending: true
			}
		)
		.order(
			'sort_order',
			{
				ascending: true
			}
		)

	if (error) {
		throw error
	}


	const assets =
		data ?? []


	const assetsWithPreview =
		await Promise.all(
			assets.map(
				async asset => {
					const previewUrl =
						await createAssetSignedUrl(
							asset.file_path
						)

					return {
						...asset,
						preview_url:
						previewUrl
					}
				}
			)
		)


	return assetsWithPreview
}


// =========================================================
// Create Signed URL
// =========================================================

async function createAssetSignedUrl(
	filePath
) {
	const {
		data,
		error
	} = await supabase
		.storage
		.from(
			PRODUCT_ASSET_BUCKET
		)
		.createSignedUrl(
			filePath,
			SIGNED_URL_EXPIRES_IN
		)

	if (error) {
		console.error(
			'建立 Signed URL 失敗',
			error
		)

		return null
	}

	return data?.signedUrl ?? null
}


// =========================================================
// Get Next Sort Order
// =========================================================

async function getNextAssetSortOrder(
	productId,
	assetType
) {
	const {
		data,
		error
	} = await supabase
		.from('product_assets')
		.select('sort_order')
		.eq(
			'product_id',
			productId
		)
		.eq(
			'asset_type',
			assetType
		)
		.order(
			'sort_order',
			{
				ascending: false
			}
		)
		.limit(1)


	if (error) {
		throw error
	}


	if (
		!data ||
		data.length === 0
	) {
		return 0
	}


	return (
		data[0].sort_order + 1
	)
}


// =========================================================
// Upload Product Asset
// =========================================================

export async function uploadProductAsset(
	productId,
	assetType,
	file
) {
	const extension = 'jpg'

	const fileName =
		`${crypto.randomUUID()}.${extension}`

	const filePath =
		`${productId}/${assetType}/${fileName}`


	const sortOrder =
		await getNextAssetSortOrder(
			productId,
			assetType
		)


	// -------------------------------------------------------
	// Storage Upload
	// -------------------------------------------------------

	const {
		error: uploadError
	} = await supabase
		.storage
		.from(
			PRODUCT_ASSET_BUCKET
		)
		.upload(
			filePath,
			file,
			{
				contentType:
				file.type,

				upsert: false
			}
		)


	if (uploadError) {
		throw uploadError
	}


	// -------------------------------------------------------
	// Database
	// -------------------------------------------------------

	const {
		data,
		error
	} = await supabase
		.from('product_assets')
		.insert({
			product_id:
			productId,

			asset_type:
			assetType,

			file_path:
			filePath,

			sort_order:
			sortOrder
		})
		.select()
		.single()


	if (error) {
		// DB 寫入失敗時，
		// 把剛剛 Storage 的檔案清掉。

		await supabase
			.storage
			.from(
				PRODUCT_ASSET_BUCKET
			)
			.remove([
				filePath
			])

		throw error
	}


	const previewUrl =
		await createAssetSignedUrl(
			filePath
		)


	return {
		...data,
		preview_url:
		previewUrl
	}
}


// =========================================================
// Delete Product Asset
// =========================================================

export async function deleteProductAsset(
	asset
) {
	// -------------------------------------------------------
	// Storage
	// -------------------------------------------------------

	const {
		error: storageError
	} = await supabase
		.storage
		.from(
			PRODUCT_ASSET_BUCKET
		)
		.remove([
			asset.file_path
		])


	if (storageError) {
		throw storageError
	}


	// -------------------------------------------------------
	// Database
	// -------------------------------------------------------

	const {
		error: databaseError
	} = await supabase
		.from('product_assets')
		.delete()
		.eq(
			'id',
			asset.id
		)


	if (databaseError) {
		throw databaseError
	}
}


// =========================================================
// Payload Builder
// =========================================================

function buildProductPayload(
	productData
) {
	return {
		sku:
			productData
				.sku
				.trim(),

		name:
			productData
				.name
				.trim(),

		brand:
			productData
				.brand
				?.trim() ||
			null,

		model:
			productData
				.model
				?.trim() ||
			null,

		color:
			productData
				.color
				?.trim() ||
			null,

		product_type:
		productData
			.productType,

		part_category:
			productData.productType ===
			'part'
				? productData
					.partCategory
				: null,

		part_category_other:
			productData.productType ===
			'part' &&
			productData.partCategory ===
			'other'
				? productData
					.partCategoryOther
					?.trim() ||
				null
				: null,

		part_is_metal:
			productData.productType ===
			'part'
				? productData
					.partIsMetal
				: null
	}
}
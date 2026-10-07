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


export const GUN_DOCUMENT_ASSET_TYPES = [
	'certification_statement',
	'traditional_chinese_translation',
	'energy_report'
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
// Update Product Active Status
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
// Get Product Component Specs
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


// =========================================================
// Save Product Component Specs
// =========================================================

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

				const materialStatus =
					spec?.materialStatus ??
					null


				return {
					product_id:
					productId,

					component_type:
					componentType,

					material_status:
					materialStatus,

					is_metal:
						materialStatus ===
						'metal'
							? true
							: materialStatus ===
							'non_metal'
								? false
								: null,

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


// =========================================================
// Delete Product Component Specs
// =========================================================

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
// Get Product Assets
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


	return Promise.all(
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
// File Extension
// =========================================================

function getFileExtension(
	file
) {
	const fileName =
		file?.name ?? ''


	const lastDotIndex =
		fileName.lastIndexOf('.')


	if (
		lastDotIndex >= 0 &&
		lastDotIndex <
		fileName.length - 1
	) {
		return fileName
			.slice(
				lastDotIndex + 1
			)
			.toLowerCase()
	}


	const mimeExtensions = {
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',

		'application/pdf':
			'pdf',

		'application/msword':
			'doc',

		'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
			'docx'
	}


	return (
		mimeExtensions[
			file?.type
			] ??
		'bin'
	)
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
	const extension =
		getFileExtension(
			file
		)


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
					file.type ||
					undefined,

				upsert:
					false
			}
		)


	if (uploadError) {
		throw uploadError
	}


	// -------------------------------------------------------
	// Database Insert
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
			sortOrder,

			original_file_name:
				file.name ||
				null,

			mime_type:
				file.type ||
				null,

			file_size:
				Number.isFinite(
					file.size
				)
					? file.size
					: null
		})
		.select()
		.single()


	if (error) {
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
// Product Payload Builder
// =========================================================

function buildProductPayload(
	productData
) {
	return {
		name:
			productData
				.name
				.trim(),

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
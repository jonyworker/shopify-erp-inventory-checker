// =========================================================
// Product Image Utils
// =========================================================

const ALLOWED_IMAGE_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp'
]


// =========================================================
// Validate Image
// =========================================================

export function validateProductImage(file) {
	if (!file) {
		throw new Error('沒有選擇圖片')
	}

	if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
		throw new Error(
			'只支援 JPG、PNG、WebP 圖片'
		)
	}
}


// =========================================================
// Load Image
// =========================================================

function loadImage(file) {
	return new Promise((resolve, reject) => {
		const image = new Image()

		const objectUrl =
			URL.createObjectURL(file)

		image.onload = () => {
			URL.revokeObjectURL(objectUrl)
			resolve(image)
		}

		image.onerror = () => {
			URL.revokeObjectURL(objectUrl)

			reject(
				new Error('無法讀取圖片')
			)
		}

		image.src = objectUrl
	})
}


// =========================================================
// Canvas → Blob
// =========================================================

function canvasToBlob(
	canvas,
	type,
	quality
) {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			blob => {
				if (!blob) {
					reject(
						new Error('圖片壓縮失敗')
					)

					return
				}

				resolve(blob)
			},
			type,
			quality
		)
	})
}


// =========================================================
// Compress Product Image
// =========================================================

export async function compressProductImage(
	file,
	{
		maxDimension = 1600,
		quality = 0.85
	} = {}
) {
	validateProductImage(file)

	const image =
		await loadImage(file)


	// -------------------------------------------------------
	// Calculate Size
	// -------------------------------------------------------

	const originalWidth =
		image.naturalWidth

	const originalHeight =
		image.naturalHeight

	const longestSide =
		Math.max(
			originalWidth,
			originalHeight
		)

	const scale =
		longestSide > maxDimension
			? maxDimension / longestSide
			: 1

	const width =
		Math.round(
			originalWidth * scale
		)

	const height =
		Math.round(
			originalHeight * scale
		)


	// -------------------------------------------------------
	// Canvas
	// -------------------------------------------------------

	const canvas =
		document.createElement('canvas')

	canvas.width = width
	canvas.height = height

	const context =
		canvas.getContext('2d')

	if (!context) {
		throw new Error(
			'無法建立圖片處理環境'
		)
	}


	// PNG 透明背景轉 JPEG 時，
	// 使用白色背景避免透明區域變黑。

	context.fillStyle = '#ffffff'

	context.fillRect(
		0,
		0,
		width,
		height
	)

	context.drawImage(
		image,
		0,
		0,
		width,
		height
	)


	// -------------------------------------------------------
	// JPEG
	// -------------------------------------------------------

	const blob =
		await canvasToBlob(
			canvas,
			'image/jpeg',
			quality
		)


	const fileName =
		file.name
			.replace(/\.[^.]+$/, '')
			.replace(/[^\w-]+/g, '_')


	return new File(
		[blob],
		`${fileName}.jpg`,
		{
			type: 'image/jpeg',
			lastModified: Date.now()
		}
	)
}


// =========================================================
// Compression Settings By Asset Type
// =========================================================

export function getImageCompressionOptions(
	assetType
) {
	// 爆炸圖通常有較細的文字與線條，
	// 所以保留較大的尺寸。

	if (
		assetType === 'exploded_diagram'
	) {
		return {
			maxDimension: 2000,
			quality: 0.9
		}
	}


	return {
		maxDimension: 1600,
		quality: 0.85
	}
}


// =========================================================
// Format File Size
// =========================================================

export function formatFileSize(bytes) {
	if (!Number.isFinite(bytes)) {
		return '-'
	}

	if (bytes < 1024) {
		return `${bytes} B`
	}

	if (bytes < 1024 * 1024) {
		return `${(
			bytes / 1024
		).toFixed(1)} KB`
	}

	return `${(
		bytes /
		1024 /
		1024
	).toFixed(1)} MB`
}
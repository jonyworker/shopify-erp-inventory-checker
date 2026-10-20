import {
  permissionList,
  permissionLoading,
  permissionReady,
  permissionError,
  permissionUserId,
  permissionUpdatedAt,
  isSystemAdmin,
  can,
  canViewTool,
  getPermissionDetail,
  refreshPermissions
} from '@/stores/permissionState'

/**
 * 在任何 Vue 3 <script setup> 中使用：
 *
 * const { can, canViewTool, isSystemAdmin, permissionReady } = usePermission()
 *
 * can('meetingArchive.view')
 * canViewTool('priceErp')
 *
 * Phase 02-B 僅提供狀態與判斷；尚未用它鎖定既有工具。
 */
export function usePermission() {
  return {
    permissions: permissionList,
    permissionLoading,
    permissionReady,
    permissionError,
    permissionUserId,
    permissionUpdatedAt,
    isSystemAdmin,
    can,
    canViewTool,
    getPermissionDetail,
    refreshPermissions
  }
}

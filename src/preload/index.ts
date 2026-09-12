import { contextBridge, ipcRenderer } from 'electron';
import type { AgentBatonApi } from '../shared/ipc';

const api: AgentBatonApi = {
  dashboard: {
    load: () => ipcRenderer.invoke('dashboard:load')
  },
  library: {
    load: () => ipcRenderer.invoke('library:load')
  },
  settings: {
    chooseAndAddScanRoot: (kind) => ipcRenderer.invoke('settings:choose-and-add-scan-root', kind),
    removeScanRoot: (path) => ipcRenderer.invoke('settings:remove-scan-root', path)
  },
  adoption: {
    chooseAndPreview: () => ipcRenderer.invoke('adoption:choose-and-preview'),
    previewPath: (path) => ipcRenderer.invoke('adoption:preview-path', path),
    previewUpstream: (repositoryUrl, relativePath) => ipcRenderer.invoke('adoption:preview-upstream', { repositoryUrl, relativePath }),
    confirm: (input) => ipcRenderer.invoke('adoption:confirm', input)
  },
  skills: {
    previewDelete: (skillId) => ipcRenderer.invoke('skills:delete-preview', skillId),
    confirmDelete: (previewId) => ipcRenderer.invoke('skills:delete-confirm', { previewId }),
    restore: (skillId) => ipcRenderer.invoke('skills:restore', skillId),
    previewSyncPolicy: (skillId, nextPolicy) => ipcRenderer.invoke('skills:sync-policy-preview', { skillId, nextPolicy }),
    confirmSyncPolicy: (previewId) => ipcRenderer.invoke('skills:sync-policy-confirm', { previewId }),
    updateMetadata: (skillId, input) => ipcRenderer.invoke('skills:update-metadata', { skillId, ...input })
  },
  upstream: {
    check: (skillId) => ipcRenderer.invoke('upstream:check', skillId),
    previewUpdate: (skillId) => ipcRenderer.invoke('upstream:preview-update', skillId),
    previewDiscardLocalForkAndUpdate: (skillId) => ipcRenderer.invoke('upstream:preview-discard-fork-and-update', skillId),
    confirmUpdate: (previewId) => ipcRenderer.invoke('upstream:confirm-update', { previewId })
  },
  diagnostics: {
    preview: () => ipcRenderer.invoke('diagnostics:preview'),
    chooseAndGenerate: () => ipcRenderer.invoke('diagnostics:choose-and-generate'),
    recordLocalError: (message) => ipcRenderer.invoke('diagnostics:record-local-error', message),
    listLocalErrors: () => ipcRenderer.invoke('diagnostics:list-local-errors'),
    clearLocalErrors: () => ipcRenderer.invoke('diagnostics:clear-local-errors')
  },
  sync: {
    connection: () => ipcRenderer.invoke('sync:connection'),
    clearConnection: () => ipcRenderer.invoke('sync:connection-clear'),
    chooseAndPreviewPush: () => ipcRenderer.invoke('sync:choose-and-preview-push'),
    previewSavedPush: () => ipcRenderer.invoke('sync:preview-saved-push'),
    confirmPush: (previewId) => ipcRenderer.invoke('sync:confirm-push', { previewId }),
    chooseAndPreviewRestore: () => ipcRenderer.invoke('sync:choose-and-preview-restore'),
    cloneAndPreviewRestore: (repositoryUrl) => ipcRenderer.invoke('sync:clone-and-preview-restore', { repositoryUrl }),
    confirmRestore: (previewId) => ipcRenderer.invoke('sync:confirm-restore', { previewId })
  },
  github: {
    startAuthorization: () => ipcRenderer.invoke('github:authorization-start'),
    pollAuthorization: (id) => ipcRenderer.invoke('github:authorization-poll', id),
    isConnected: () => ipcRenderer.invoke('github:authorization-status'),
    disconnect: () => ipcRenderer.invoke('github:authorization-disconnect')
  },
  groups: {
    create: (name) => ipcRenderer.invoke('groups:create', { name }),
    addSkill: (groupId, skillId) => ipcRenderer.invoke('groups:add-skill', { groupId, skillId }),
    removeSkill: (groupId, skillId) => ipcRenderer.invoke('groups:remove-skill', { groupId, skillId }),
    rename: (groupId, name) => ipcRenderer.invoke('groups:rename', { groupId, name }),
    previewDelete: (groupId) => ipcRenderer.invoke('groups:delete-preview', groupId),
    confirmDelete: (previewId) => ipcRenderer.invoke('groups:delete-confirm', { previewId }),
    setSyncParticipation: (groupId, participatesInSync) =>
      ipcRenderer.invoke('groups:set-sync-participation', { groupId, participatesInSync })
  },
  agents: {
    view: (agent) => ipcRenderer.invoke('agents:view', agent),
    setActiveGroups: (agent, groupIds) =>
      ipcRenderer.invoke('agents:set-active-groups', { agent, groupIds }),
    setActiveGroupsForAgents: (agents, groupIds) =>
      ipcRenderer.invoke('agents:set-active-groups-batch', { agents, groupIds }),
    setSkillOverride: (agent, skillId, override) =>
      ipcRenderer.invoke('agents:set-skill-override', { agent, skillId, override }),
    verifyAfterRestart: (agent) => ipcRenderer.invoke('agents:verify-after-restart', agent)
  },
  apply: {
    preview: (agent) => ipcRenderer.invoke('apply:preview', agent),
    confirm: (planId) => ipcRenderer.invoke('apply:confirm', { planId }),
    previewBatch: (agents) => ipcRenderer.invoke('apply:preview-batch', agents),
    confirmBatch: (previewId) => ipcRenderer.invoke('apply:confirm-batch', { previewId }),
    previewUndo: (agent) => ipcRenderer.invoke('apply:preview-undo', agent),
    confirmUndo: (previewId) => ipcRenderer.invoke('apply:confirm-undo', { previewId })
  }
};

contextBridge.exposeInMainWorld('agentBaton', api);

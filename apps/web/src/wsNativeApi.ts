import { type ContextMenuItem, type NativeApi } from "@t3tools/contracts";

import { useContextMenuStore } from "./contextMenuStore";
import { resetServerStateForTests } from "./rpc/serverState";
import { __resetWsRpcClientForTests, getWsRpcClient } from "./wsRpcClient";

let instance: { api: NativeApi } | null = null;

export function __resetWsNativeApiForTests() {
  instance = null;
  __resetWsRpcClientForTests();
  resetServerStateForTests();
}

export function createWsNativeApi(): NativeApi {
  if (instance) {
    return instance.api;
  }

  const rpcClient = getWsRpcClient();

  const api: NativeApi = {
    dialogs: {
      pickFolder: async () => {
        if (!window.desktopBridge) return null;
        return window.desktopBridge.pickFolder();
      },
      confirm: async (message) => {
        if (window.desktopBridge) {
          return window.desktopBridge.confirm(message);
        }
        return window.confirm(message);
      },
    },
    terminal: {
      open: (input) => rpcClient.terminal.open(input as never),
      write: (input) => rpcClient.terminal.write(input as never),
      resize: (input) => rpcClient.terminal.resize(input as never),
      clear: (input) => rpcClient.terminal.clear(input as never),
      restart: (input) => rpcClient.terminal.restart(input as never),
      close: (input) => rpcClient.terminal.close(input as never),
      onEvent: (callback) => rpcClient.terminal.onEvent(callback),
    },
    projects: {
      enhanceSystemPrompt: rpcClient.projects.enhanceSystemPrompt,
      searchEntries: rpcClient.projects.searchEntries,
      writeFile: rpcClient.projects.writeFile,
      listDirectory: rpcClient.projects.listDirectory,
      readFile: rpcClient.projects.readFile,
    },
    prompts: {
      listDefinitions: rpcClient.prompts.listDefinitions,
      getDocument: rpcClient.prompts.getDocument,
      validateDocument: rpcClient.prompts.validateDocument,
      previewDocument: rpcClient.prompts.previewDocument,
      updateDocument: rpcClient.prompts.updateDocument,
    },
    managedRuns: {
      launchProjectScript: rpcClient.managedRuns.launchProjectScript,
      list: rpcClient.managedRuns.list,
      get: rpcClient.managedRuns.get,
      getLogs: rpcClient.managedRuns.getLogs,
      listInferenceRecords: rpcClient.managedRuns.listInferenceRecords,
      getInferenceRecord: rpcClient.managedRuns.getInferenceRecord,
      stop: rpcClient.managedRuns.stop,
      onEvent: (projectId, callback) => rpcClient.managedRuns.onEvent(projectId, callback),
    },
    scheduledTasks: {
      list: rpcClient.scheduledTasks.list,
      get: rpcClient.scheduledTasks.get,
      create: rpcClient.scheduledTasks.create,
      update: rpcClient.scheduledTasks.update,
      delete: rpcClient.scheduledTasks.delete,
      toggle: rpcClient.scheduledTasks.toggle,
      runNow: rpcClient.scheduledTasks.runNow,
      listRuns: rpcClient.scheduledTasks.listRuns,
      onEvent: (callback) => rpcClient.scheduledTasks.onEvent(callback),
    },
    ticketing: {
      list: rpcClient.ticketing.list,
      getById: rpcClient.ticketing.getById,
      getByIdentifier: rpcClient.ticketing.getByIdentifier,
      getThreadLinks: rpcClient.ticketing.getThreadLinks,
      getBody: rpcClient.ticketing.getBody,
      searchBody: rpcClient.ticketing.searchBody,
      getBodySections: rpcClient.ticketing.getBodySections,
      editBody: rpcClient.ticketing.editBody,
      listCriteria: rpcClient.ticketing.listCriteria,
      editCriteria: rpcClient.ticketing.editCriteria,
      create: rpcClient.ticketing.create,
      update: rpcClient.ticketing.update,
      delete: rpcClient.ticketing.delete,
      archive: rpcClient.ticketing.archive,
      unarchive: rpcClient.ticketing.unarchive,
      reorder: rpcClient.ticketing.reorder,
      search: rpcClient.ticketing.search,
      getTree: rpcClient.ticketing.getTree as never,
      setDependencies: rpcClient.ticketing.setDependencies,
      addDependency: rpcClient.ticketing.addDependency,
      removeDependency: rpcClient.ticketing.removeDependency,
      updateCriterionStatus: rpcClient.ticketing.updateCriterionStatus,
      getHistory: rpcClient.ticketing.getHistory,
      listLabels: rpcClient.ticketing.listLabels,
      createLabel: rpcClient.ticketing.createLabel,
      updateLabel: rpcClient.ticketing.updateLabel,
      deleteLabel: rpcClient.ticketing.deleteLabel,
      addTicketLabel: rpcClient.ticketing.addTicketLabel,
      removeTicketLabel: rpcClient.ticketing.removeTicketLabel,
      listComments: rpcClient.ticketing.listComments,
      createComment: rpcClient.ticketing.createComment,
      updateComment: rpcClient.ticketing.updateComment,
      deleteComment: rpcClient.ticketing.deleteComment,
      listArtifacts: rpcClient.ticketing.listArtifacts,
      createArtifact: rpcClient.ticketing.createArtifact,
      updateArtifact: rpcClient.ticketing.updateArtifact,
      deleteArtifact: rpcClient.ticketing.deleteArtifact,
      listTemplates: rpcClient.ticketing.listTemplates,
      getTemplate: rpcClient.ticketing.getTemplate,
      createTemplate: rpcClient.ticketing.createTemplate,
      updateTemplate: rpcClient.ticketing.updateTemplate,
      deleteTemplate: rpcClient.ticketing.deleteTemplate,
      onEvent: (callback) => rpcClient.ticketing.onEvent(callback),
    },
    shell: {
      openInEditor: (cwd, editor) => rpcClient.shell.openInEditor({ cwd, editor }),
      openExternal: async (url) => {
        if (window.desktopBridge) {
          const opened = await window.desktopBridge.openExternal(url);
          if (!opened) {
            throw new Error("Unable to open link.");
          }
          return;
        }

        window.open(url, "_blank", "noopener,noreferrer");
      },
    },
    git: {
      pull: rpcClient.git.pull,
      status: rpcClient.git.status,
      listBranches: rpcClient.git.listBranches,
      createWorktree: rpcClient.git.createWorktree,
      removeWorktree: rpcClient.git.removeWorktree,
      createBranch: rpcClient.git.createBranch,
      checkout: rpcClient.git.checkout,
      init: rpcClient.git.init,
      resolvePullRequest: rpcClient.git.resolvePullRequest,
      preparePullRequestThread: rpcClient.git.preparePullRequestThread,
      discoverRepos: rpcClient.git.discoverRepos,
    },
    contextMenu: {
      show: <T extends string>(
        items: readonly ContextMenuItem<T>[],
        position?: { x: number; y: number },
      ): Promise<T | null> => {
        return useContextMenuStore.getState().show(items, position);
      },
    },
    server: {
      getConfig: rpcClient.server.getConfig,
      refreshProviders: rpcClient.server.refreshProviders,
      upsertKeybinding: rpcClient.server.upsertKeybinding,
      getSettings: rpcClient.server.getSettings,
      updateSettings: rpcClient.server.updateSettings,
      resolveMcpServers: rpcClient.server.resolveMcpServers,
      resolveCodexProjectTrust: rpcClient.server.resolveCodexProjectTrust,
      trustCodexProject: rpcClient.server.trustCodexProject,
      resolveSkills: rpcClient.server.resolveSkills,
    },
    orchestration: {
      getSnapshot: rpcClient.orchestration.getSnapshot,
      getStartupSnapshot: rpcClient.orchestration.getStartupSnapshot,
      listProjects: () => rpcClient.orchestration.listProjects().then((projects) => [...projects]),
      getThreadContent: rpcClient.orchestration.getThreadContent,
      dispatchCommand: rpcClient.orchestration.dispatchCommand,
      getTurnDiff: rpcClient.orchestration.getTurnDiff,
      getFullThreadDiff: rpcClient.orchestration.getFullThreadDiff,
      replayEvents: (fromSequenceExclusive) =>
        rpcClient.orchestration
          .replayEvents({ fromSequenceExclusive })
          .then((events) => [...events]),
      onDomainEvent: (callback) => rpcClient.orchestration.onDomainEvent(callback),
      createRun: rpcClient.orchestration.createRun,
      startRun: rpcClient.orchestration.startRun,
      listRuns: (input) => rpcClient.orchestration.listRuns(input).then((runs) => [...runs]),
      getRun: rpcClient.orchestration.getRun,
    },
  };

  instance = { api };
  return api;
}

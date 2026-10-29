"use client";

import { useState } from "react";

import { useQuery } from "@tanstack/react-query";

import { ErrorNotice } from "@/components/error-notice";
import { ApiError } from "@/lib/api";
import { browserConfiguration } from "@/lib/browser-environment";

import { ConfigurationNotice } from "./configuration-notice";
import { ProjectWorkspace } from "./project-workspace";
import { bootstrapOptions } from "./queries";
import { WorkspaceFrame } from "./workspace-shell";
import { resolveSelection } from "./workspace-state";

export function Workbench() {
  const configurationIssues = browserConfiguration();
  const bootstrap = useQuery({
    ...bootstrapOptions(),
    enabled: !configurationIssues.length,
  });
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const project = resolveSelection(
    bootstrap.data?.projects ?? [],
    selectedProjectId,
  );
  const needsAuth =
    process.env.NEXT_PUBLIC_AUTH_MODE === "supabase" &&
    bootstrap.error instanceof ApiError &&
    bootstrap.error.status === 401 &&
    bootstrap.error.code !== "configuration_error";
  if (
    configurationIssues.length ||
    (!bootstrap.data &&
      bootstrap.error instanceof ApiError &&
      bootstrap.error.code === "configuration_error")
  )
    return (
      <WorkspaceFrame connection="offline" navigation={null} projectBar={null}>
        <ConfigurationNotice
          issues={
            configurationIssues.length
              ? configurationIssues
              : [bootstrap.error!.message]
          }
        />
      </WorkspaceFrame>
    );
  if (!bootstrap.data && bootstrap.isError && !needsAuth)
    return (
      <WorkspaceFrame connection="offline" navigation={null} projectBar={null}>
        <ErrorNotice
          title="Connection unavailable"
          error={bootstrap.error}
          onRetry={() => void bootstrap.refetch()}
        />
      </WorkspaceFrame>
    );
  return (
    <ProjectWorkspace
      key={project?.id ?? "unselected"}
      project={project}
      bootstrap={bootstrap.data}
      connection={
        bootstrap.isPending
          ? "connecting"
          : bootstrap.isError
            ? "offline"
            : "connected"
      }
      bootstrapError={bootstrap.error}
      needsAuth={needsAuth}
      onRetryBootstrap={() => void bootstrap.refetch()}
      onProjectChange={setSelectedProjectId}
    />
  );
}

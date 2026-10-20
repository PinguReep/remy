#requires -Version 5.1
<#
.SYNOPSIS
  Audit STRICTEMENT EN LECTURE SEULE des sources de sessions de la tour :
  Claude Code, T3 Code et Codex. Prépare la conception de la mémoire de projets de Rémy.

.DESCRIPTION
  Ce que le script fait :
    - inventorie %USERPROFILE%\.claude (et CLAUDE_CONFIG_DIR), les dossiers de projets,
      le nombre, la taille et les dates (au jour) des sessions, sous-agents et workflows compris ;
    - pour un échantillon de sessions récentes : types d'enregistrements et noms de clés,
      JAMAIS le texte d'un message ni d'un résultat d'outil ;
    - cherche T3 Code (%USERPROFILE%\.t3, T3CODE_HOME, dépôt du fork et ses worktrees, profils
      Electron, installation) et liste tables, colonnes et comptages avec node:sqlite (le moteur
      de Rémy) ou, à défaut, sqlite3.exe ;
    - inventorie %USERPROFILE%\.codex (et CODEX_HOME) ;
    - mesure la rétention effective par racine et l'âge de la plus vieille session ;
    - signale si Documents, le coffre ou .remy sont dans un dossier synchronisé (OneDrive...).

  Ce que le script ne fait JAMAIS :
    - écrire, renommer ou supprimer quoi que ce soit chez Claude Code, T3 Code ou Codex :
      SQLite n'ouvre la base de T3 qu'en immutable=1 et seulement si -wal ET -shm sont absents
      (T3 fermé) ; sinon la base n'est pas ouverte, sauf -CopieT3 (lecture d'une copie) ;
    - ouvrir userdata\secrets, logs\ (provider\events.log, terminals\, server.trace.ndjson),
      browser-artifacts\, les profils Electron (%APPDATA%\t3code*), .credentials.json, remy.env :
      seules leurs tailles sont mesurées ;
    - afficher un message, un résultat d'outil, une valeur libre ou un chemin personnel :
      seules des valeurs d'une liste blanche (types, rôles, outils standard, énumérations amont)
      apparaissent ; le reste devient un hachage salé « h-xxxxxxxx ».

  Fichiers écrits PAR LE SCRIPT (PowerShell peut écrire ses propres caches) :
    - %USERPROFILE%\.remy\prive\audit-sources-<date>.txt (créé avec le dossier s'il manque) ;
    - avec -CopieT3 seulement : %USERPROFILE%\.remy\prive\tmp-audit-<id>\ (copie EN CLAIR de la
      base T3 pendant quelques secondes), supprimé à la fin et, après un plantage, au passage suivant.

  Fichiers ouverts en lecture avec partage complet (lecture, écriture, suppression) :
  une application en train d'écrire n'est jamais bloquée.
  sqlite3.exe est lancé avec -safe (3.37 et plus) et -init NUL (~\.sqliterc ignoré).

.PARAMETER Echantillon
  Nombre de sessions récentes dont la structure est détaillée (défaut 5).
.PARAMETER MaxLignes
  Nombre maximal de lignes analysées par session de l'échantillon (défaut 4000).
.PARAMETER Projet
  Limite l'échantillon à un dossier de projet (son hachage h-xxxxxxxx), par ex. pour le test du fork.
.PARAMETER Sqlite3
  Chemin de sqlite3.exe s'il n'est pas dans le PATH (utilisé si node:sqlite manque).
.PARAMETER Moteur
  auto (défaut : node:sqlite, sinon sqlite3), node ou sqlite3.
.PARAMETER CopieT3
  Si T3 est ouvert : copie la base (et son -wal) dans .remy\prive\tmp-audit-<id>, lit la copie,
  puis l'efface. Mesure aussi la copie pendant que T3 tourne. Sans cette option, une base ouverte
  n'est pas lue.
.PARAMETER DepotFork
  Chemin d'un clone local du fork de T3 Code (migrations, worktrees, .t3 de développement). Facultatif.
.PARAMETER WSL
  Sonde les distributions WSL listées dans le registre (peut démarrer une distribution).
.PARAMETER AfficherNoms
  Affiche À L'ÉCRAN SEULEMENT la table hachage -> nom. Le rapport écrit reste masqué.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File .\audit-sources-tour.ps1
#>
[CmdletBinding()]
param(
  [ValidateRange(0, 50)][int]$Echantillon = 5,
  [ValidateRange(100, 200000)][int]$MaxLignes = 4000,
  [ValidatePattern('^(h-[0-9a-f]{8})?$')][string]$Projet = '',
  [string]$Sqlite3 = '',
  [ValidateSet('auto', 'node', 'sqlite3')][string]$Moteur = 'auto',
  [switch]$CopieT3,
  [string]$DepotFork = '',
  [switch]$WSL,
  [switch]$AfficherNoms
)

$ErrorActionPreference = 'Continue'
Set-StrictMode -Off
$script:Debut = Get-Date
$script:Lignes = New-Object System.Collections.Generic.List[string]
$script:Avertissements = New-Object System.Collections.Generic.List[string]
$script:MaxOctetsLigne = 1MB          # au-delà, une ligne JSON n'est pas décodée (seul son type est relevé)
$script:Partage = [System.IO.FileShare]::ReadWrite -bor [System.IO.FileShare]::Delete

$script:EstWindows = ([System.IO.Path]::DirectorySeparatorChar -eq [char]'\')
$Profil = $env:USERPROFILE
if ([string]::IsNullOrEmpty($Profil)) { $Profil = [Environment]::GetFolderPath('UserProfile') }

# Migrations de T3 Code amont (pingdotgg/t3code, commit 2532e64 du 19/10/2026), pour repérer celles du fork.
$script:MigrationsAmont = @(
  'OrchestrationEvents','OrchestrationCommandReceipts','CheckpointDiffBlobs','ProviderSessionRuntime','Projections',
  'ProjectionThreadSessionRuntimeModeColumns','ProjectionThreadMessageAttachments','ProjectionThreadActivitySequence',
  'ProviderSessionRuntimeMode','ProjectionThreadsRuntimeMode','OrchestrationThreadCreatedRuntimeMode',
  'ProjectionThreadsInteractionMode','ProjectionThreadProposedPlans','ProjectionThreadProposedPlanImplementation',
  'ProjectionTurnsSourceProposedPlan','CanonicalizeModelSelections','ProjectionThreadsArchivedAt',
  'ProjectionThreadsArchivedAtIndex','ProjectionSnapshotLookupIndexes','AuthAccessManagement','AuthSessionClientMetadata',
  'AuthSessionLastConnectedAt','ProjectionThreadShellSummary','BackfillProjectionThreadShellSummary',
  'CleanupInvalidProjectionPendingApprovals','CanonicalizeModelSelectionOptions','ProviderSessionRuntimeInstanceId',
  'ProjectionThreadSessionInstanceId','ProjectionThreadDetailOrderingIndexes','ProjectionThreadShellArchiveIndexes',
  'AuthAuthorizationScopes','AuthPairingProofKeyThumbprint','ProjectionThreadsSettled','ProjectionThreadsSnoozed',
  'ProjectionThreadTitleRegeneration','ProjectionThreadsPinned','ProjectionTurnsKeysetIndex','ProjectionThreadsPinOrderKey',
  'ProjectionProjectsDefaultThreadEnvMode','ProjectionProjectFaviconPath','AuthSessionClientConnection',
  'ProjectionThreadLinkedPullRequest','ProjectionThreadsUnsettledAt','ClearAutomaticProjectModelDefaults',
  'ProjectionProjectsAutoPull','RepairAutomaticSettlementTimestamps','ProjectionProjectIcon',
  'ProjectionThreadBranchPullRequest','ProjectionThreadsActiveOrderKey','ProjectionThreadPullRequests',
  'ProjectionThreadMessageContext','ProjectionThreadTitleState','PullRequestFilesViewed',
  'ProjectionThreadsAutoSettleDisabledAt','OrchestrationV2','RemoveRedundantProjectionIndexes','ScheduledTaskWebhooks',
  'WebhookRelayDeliveries','McpAppModelContext','ThreadSnapshotWindowIndexes','PullRequestReviewGuides',
  'ThreadFailureLookupIndex','DropUnusedV1Projections','CanonicalizeThreadPullRequestLinks'
)
# Préversions publiées de V2 : OrchestrationV2 enregistrée en 53 ou 54 puis renumérotée (reconcileV2PreviewMigration.ts).
$script:PremiereMigrationV2 = 55

# Listes blanches : seules ces valeurs s'affichent en clair ; toute autre valeur devient « autre:h-xxxxxxxx ».
$script:Connus = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::Ordinal)
$listeClaude = @'
user assistant attachment system summary custom-title agent-name last-prompt mode cost-state queue-operation atis-latch
file-history-snapshot progress started result launched compact_boundary stop_hook_summary local_command api_error informational
text thinking redacted_thinking tool_use tool_result image document tool_reference server_tool_use web_search_tool_result
web_fetch_tool_result search_result mcp_tool_use mcp_tool_result base64 url developer tool end_turn max_tokens stop_sequence
pause_turn refusal human task-notification peer cli sdk-cli sdk-ts sdk-py claude-vscode claude-desktop mcp claude-code-github-action
interactive idle busy running waiting stopped auto manual <synthetic>
Agent Task Bash BashOutput KillShell KillBash Read Write Edit MultiEdit NotebookEdit NotebookRead Glob Grep LS WebFetch WebSearch
TodoWrite TodoRead ExitPlanMode EnterPlanMode Skill SlashCommand ToolSearch AskUserQuestion TaskCreate TaskGet TaskList TaskUpdate
TaskStop TaskOutput Monitor Workflow SendMessage ListAgents ReadNotifications SubagentHandback SendUserFile PushNotification
StructuredOutput LSP EnterWorktree ExitWorktree CronCreate CronDelete CronList ListMcpResourcesTool ReadMcpResourceTool
general-purpose Explore Plan statusline-setup output-style-setup claude-code-guide workflow-subagent
session_meta response_item event_msg turn_context compacted message reasoning function_call function_call_output custom_tool_call
custom_tool_call_output local_shell_call web_search_call agent_message user_message agent_reasoning token_count task_started
task_complete turn_aborted exec_command_begin exec_command_end patch_apply_begin patch_apply_end codex_cli_rs codex_vscode
codex_app_server codex_exec exec vscode app-server openai ollama azure openrouter
table view TEXT INTEGER REAL BLOB NUMERIC (null)
'@
# Énumérations de T3 Code amont (Schema.Literal(s) de packages/contracts et pilotes, commit 2532e64).
$listeT3 = @'
accept accessibility account.rate-limits.updated account.updated acp acp.jsonrpc acpRegistry action_failed action_finished action_started active
activity added agent agent_activity_publish_proof_expired agent_activity_publish_proof_invalid all all-io always and android antigravity app app_owned
append approval_request approve approved archive archived arm64 array artwork assistant assistant_message async attach attached attachment auth
auth.status auth_invalid auth_refresh authored authorization_code auto automatic available background background_command background_task base64 behind
binary blue-orange boolean boot-service both-shift-keys branch branch-range broken browser browser-artifacts buffered bunx cache cached camera-shutter
cancelDesktopUpdate cancel_requested cancelled captured-image cdp change changes-requested charging check checkpoint checkpoint-scope.created
checkpoint.captured checkpoint.rollback checkpoint.rollback-requested checkpoint.rollback.fail checkpoint_context claude claude.sdk.message
claude.sdk.permission claudeAgent claudeCode clear clearLocation cleared cli click client client-boundary clientRemoved clientUpserted cliproxy closed
code codex codex.app-server.notification codex.app-server.request codex.eventmsg codex.sdk.thread-event comfortable command command_execution comment
commit commitDesktopUpdate committed compaction compatible complete completed computer config.warning configure conflicting connected content.delta
context context-handoff.updated context-transfer.created context-transfer.updated contract conversation cookies create created created_at credentials
cursor custom dark darwin day decline declined default defer_start delegated_task delegated_task.completion-delivery.acknowledge
delegated_task.completion-delivery.dispose delegated_task.request delegated_task.wake-policy deleted delta_context deprecation.notice desktop desktop-
app desktop-bootstrap desktop-renderer desktopTelemetry desktopTelemetryHello desktopUpdateStatus detached deviceCode diagnostics direct direct-path
direct-private-network directory disabled disk_space dismissed disposed domContentLoaded done double-click down download downloading draft
dynamic_tool dynamic_tool_call element element-tree emit_inbound emoji empty enableCursorKeychain enter env_var environment environment-port
environment:connect environment:status environmentThemesUpdated environment_connect_not_authorized environment_endpoint_timed_out
environment_endpoint_unavailable environment_link_failed environment_link_limit_exceeded environment_link_proof_expired environment_link_proof_invalid
environment_link_unavailable error event existing existing_worktree exitCode exited expect_outbound expired external extra-large failed failing false
file file-explorer file_change file_search files files.persisted fill finder finished fixed_time flat-text focused-element fork fork_delta_context
freeform fresh full full-disk-access git git-compatible-fallback git-refs git-remote github gnome gnome-extension goto graceful grant grok handoff
header hello helper_missing hex hide historyChunk hold hook.completed hook.progress hook.started hook_finished hook_output hook_started host hosted
hour http https hub human hyprland identifier idle image inProgress inactive incognito incoming inherit inherited initial injected inline install
installing insufficient_scope integration internal_error interrupt_requested interrupted interval invalidWindow invalid_client_metadata
invalid_redirect_uri invalid_request ios issue-comment item.completed item.started item.updated jj kde kept key keybindings.invalid-entry
keybindings.malformed-config keybindingsUpdated known-hosts lan landscape large latest latest_stable launchApp launch_failed left
legacyThreadMigration libraries light line-column linux live load local locale locator logs lucide main_agent managed manual mcp-app
mcp.oauth.completed mcp.status.updated mdns mention merge mergeable merged message message.dispatch message.updated messages metrics middle migrate
missing mixed mobile mod-enter mod-enter-multiline model.rerouted modelPriced modifier-pair monitor monogram monthly move muse native nativeCli
native_fork navigated never new nightly niri no-script no_active_run node node.updated none not not-created not-found not-installed not-running
not_found not_loaded not_resumable notification notification.delivery.accept npm-global npx null number object off offline ok old ollama on one-time-
token online only open open-workspace openUrl open_pr opencode opencode.sdk.event opened opened_existing openrouter operation_forbidden or other
outgoing output override pairingLinkRemoved pairingLinkUpserted paragraph parse partial passing path pending persistent phase_started phone pi picker
pill plan plan.updated pnpm-dlx pointer portable_context portal portrait pr prepared-run.fail prepared-run.progress prepared-run.release prepared-
run.retry preparing preset preview preview-annotation private probeFailed processTable product production progress project project.create
project.created project.delete project.deleted project.meta-updated project.removed project.update project.updated project.upserted proposed_plan
provider provider-session.attached provider-session.detach provider-session.detached provider-session.updated provider-status provider-thread.updated
provider-turn.updated provider.switch providerReported providerStatuses provider_native provider_recovery provider_thread public pulled push pushed
queue queue.resume queue_after_active queued queued-message.promote-to-steer queued-run.cancel queued-run.edit queued-run.reorder read read-projects
read-settings readHistory ready reasoning rebase recover recovery_required recursive red-green register registry relay release remote remote_added
remove removed rename-changed rename-pure replace request request-changes request.opened request.resolved requestDesktopUpdate requested reset resized
resolved respawn response restart restart_active restarted result_available retry reusable review-comment review-required reviewing revoke right risk
rolled-back rolled_back root root_run run run-attempt.created run-attempt.updated run.background-work-cancelled run.created run.interrupt run.updated
run_action run_interrupt_request run_interrupt_result running runtime-request.respond runtime-request.updated runtime.error runtime.warning
runtime_exit sampleNow sandbox save saved scanFailed scheduled screenshot-portal script. secret_request secret_request.record select selector semantic
send sendPush server server-config session session.configured session.exited session.started session.state.changed set setAppearance setColorFilter
setDiagnosticsDemand setExternalProcesses setHostPowerIntervals setLiquidGlass setLocation setOrientation setPermission setSampleInterval setStreaming
setTextSize setToggle settingsUpdated settled settled_only setup sha256 shake shared shell shortcut-changed shutdown skill skipped
skipped_not_requested skipped_up_to_date small snap-shot snapshot soft-pop split squash ssh ssh-config stacked stale start_immediately started
starting static stderr stdout steer steer_active steered steering_restart stop-failed stopped storage streaming string strong subagent subagent.stop
subagent.updated succeeded success superseded synchronized synthetic system system_notice t3 t3-mobile t3-web tablet tailnet tailscale task
task.completed task.progress task.started task.updated team terminal terminateApp thread thread.active.reorder thread.archive thread.auto-settle
thread.auto-settle.set thread.background-work.settle thread.create thread.created thread.created.record thread.delete thread.fork thread.interaction-
mode.set thread.mark-unread thread.merge_back thread.metadata.update thread.metadata.updated thread.model-selection.set thread.pin thread.pin.reorder
thread.pull-request-link-updated thread.pull-request-link.sync thread.pull-request-watch.sync thread.pull-request.link thread.pull-request.sync
thread.pull-request.unlink thread.pull-request.watch thread.realtime.audio.delta thread.realtime.closed thread.realtime.error thread.realtime.item-
added thread.realtime.started thread.removed thread.runtime-mode.set thread.settle thread.snooze thread.started thread.state.changed thread.stop
thread.title.regeneration.complete thread.token-usage.updated thread.unarchive thread.unpin thread.unsettle thread.unsnooze thread.updated
thread.user-input.dismiss thread.visit thread_created thread_not_found timed_out timeout tinted todo_list tool tool.denied tool.progress tool.summary
top-level traces tradeoff transcript_start true truncate tunnel_released turn turn-item.updated turn.aborted turn.completed turn.diff.updated
turn.plan.updated turn.proposed.completed turn.proposed.delta turn.started unavailable unclaimed unconfigured unexpected unknown unknown-event
unplugged unpriced unsupported unsupported-protocol unviewed up up-to-date update-required updated updated_at upsert url usageLimitSourcesUpdated user
user-input.requested user-input.resolved user_input user_input_request user_message uvx v1_import vcs-status viewed wait waiting waiting_for_children
warning weak web web_search webhook weekly welcome wide win32 working working-tree worktree x64
'@
foreach ($m in (($listeClaude + ' ' + $listeT3) -split '\s+')) { if ($m) { [void]$script:Connus.Add($m) } }
# Noms standard de premier niveau (le reste est haché).
$script:NomsClaude = @('projects', 'sessions', 'todos', 'shell-snapshots', 'statsig', 'ide', 'plugins', 'commands', 'agents', 'skills',
  'hooks', 'output-styles', 'settings.json', 'settings.local.json', 'history.jsonl', '.credentials.json', 'CLAUDE.md', 'file-history',
  'debug', 'plans', 'session-env', 'backups', 'tasks', 'uploads', 'paste-cache', 'image-cache', 'telemetry', 'local', 'downloads',
  'stats-cache.json', 'keybindings.json', 'teams', 'logs', 'cache')
$script:NomsT3 = @('userdata', 'dev', 'worktrees', 'logs', 'providers', 'cache', 'bin')
# Tables de T3 amont (CREATE TABLE des migrations 001-064) ; une table inconnue est propre au fork : nom haché.
$script:TablesAmont = @('effect_sql_migrations', 'sqlite_sequence', 'auth_pairing_links', 'auth_sessions', 'checkpoint_diff_blobs',
  'mcp_app_model_context', 'orchestration_command_receipts', 'orchestration_events', 'orchestration_v2_command_receipts',
  'orchestration_v2_effect_outbox', 'orchestration_v2_events', 'orchestration_v2_legacy_imports', 'orchestration_v2_projection_checkpoint_scopes',
  'orchestration_v2_projection_checkpoints', 'orchestration_v2_projection_context_handoffs', 'orchestration_v2_projection_context_transfers',
  'orchestration_v2_projection_messages', 'orchestration_v2_projection_metadata', 'orchestration_v2_projection_nodes', 'orchestration_v2_projection_plans',
  'orchestration_v2_projection_provider_session_bindings', 'orchestration_v2_projection_provider_sessions', 'orchestration_v2_projection_provider_threads',
  'orchestration_v2_projection_provider_turns', 'orchestration_v2_projection_run_attempts', 'orchestration_v2_projection_runs',
  'orchestration_v2_projection_runtime_requests', 'orchestration_v2_projection_subagents', 'orchestration_v2_projection_threads',
  'orchestration_v2_projection_turn_items', 'orchestration_v2_thread_launch_workflows', 'orchestration_v2_turn_item_positions',
  'projection_pending_approvals', 'projection_projects', 'projection_state', 'projection_thread_activities', 'projection_thread_messages',
  'projection_thread_proposed_plans', 'projection_thread_pull_requests', 'projection_thread_sessions', 'projection_threads', 'projection_turns',
  'provider_session_runtime', 'pull_request_files_viewed', 'pull_request_review_guides', 'scheduled_tasks', 'scheduled_task_webhook_deliveries',
  'scheduled_task_webhook_relay_deliveries')

# Expressions régulières (comptage uniquement, rien n'est affiché de ce qu'elles trouvent).
$script:RxSecret = New-Object System.Text.RegularExpressions.Regex(('(sk-(ant|proj|svcacct|admin)-[A-Za-z0-9_\-]{10,}|sk-[A-Za-z0-9]{20,}' +
  '|(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}|whsec_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}' +
  '|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\-]{30,}|xox[baprs]-[A-Za-z0-9\-]{10,}|tskey-[A-Za-z0-9\-]{10,}|hf_[A-Za-z0-9]{20,}|npm_[A-Za-z0-9]{20,}' +
  '|-----BEGIN [A-Z ]*PRIVATE KEY-----|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}' +
  '|[a-z][a-z0-9+.\-]*://[^\s/:@"]+:[^\s/@"]+@|(?i:bearer\s+[A-Za-z0-9._\-]{16,})|_authToken\s*=' +
  '|(?i:(password|passwd|pwd|mot de passe|secret|api[_-]?key|token)\\?"?\s*([:=]|est|is)\s*\\?"?[^\s"\\]{6,}))'),
  [System.Text.RegularExpressions.RegexOptions]::Compiled)
$script:RxType       = New-Object System.Text.RegularExpressions.Regex('"type"\s*:\s*"([A-Za-z_\-]{1,40})"')
$script:RxImage      = New-Object System.Text.RegularExpressions.Regex('"type"\s*:\s*"image"')
$script:RxEntrypoint = New-Object System.Text.RegularExpressions.Regex('"entrypoint"\s*:\s*"([^"]{1,60})"')
$script:RxVersion    = New-Object System.Text.RegularExpressions.Regex('"version"\s*:\s*"(\d+\.\d+\.\d+[^"]{0,20})"')
$script:RxCwd        = New-Object System.Text.RegularExpressions.Regex('"cwd"\s*:\s*"((?:[^"\\]|\\.){1,2000})"')
$script:RxSessionId  = New-Object System.Text.RegularExpressions.Regex('"sessionId"\s*:\s*"([0-9a-fA-F\-]{36})"')
$script:RxUuid       = New-Object System.Text.RegularExpressions.Regex('[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')

# ---------------------------------------------------------------------------
# Outils d'affichage, de masquage et de lecture sûre
# ---------------------------------------------------------------------------
function Ecrire([string]$t = '') { $script:Lignes.Add($t); Write-Host $t }
function Titre([string]$t) { Ecrire ''; Ecrire ('=' * 78); Ecrire $t; Ecrire ('=' * 78) }
function SousTitre([string]$t) { Ecrire ''; Ecrire ('--- ' + $t + ' ---') }
function Avert([string]$t) { $script:Avertissements.Add($t); Ecrire ('  /!\ ' + $t) }

function Get-Sel {
  # Sel du hachage : identifiant de la machine, lu en vue 64 bits (un PowerShell 32 bits serait
  # redirigé vers WOW6432Node, où MachineGuid manque). À défaut : sel aléatoire propre au passage,
  # jamais un repli devinable (nom de machine, compte...).
  try {
    $k = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryView]::Registry64)
    try {
      $sk = $k.OpenSubKey('SOFTWARE\Microsoft\Cryptography')
      if ($sk) { try { $g = [string]$sk.GetValue('MachineGuid'); if ($g) { $script:SourceSel = 'identifiant machine (stable d''un passage à l''autre)'; return $g } } finally { $sk.Dispose() } }
    } finally { $k.Dispose() }
  } catch {}
  # Hors Windows (essais seulement) : /etc/machine-id, stable et propre à la machine.
  try { if (-not $script:EstWindows -and [System.IO.File]::Exists('/etc/machine-id')) { $g = [System.IO.File]::ReadAllText('/etc/machine-id').Trim(); if ($g) { $script:SourceSel = 'identifiant machine (stable d''un passage à l''autre)'; return $g } } } catch {}
  $b = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($b); $rng.Dispose()
  $script:SourceSel = 'aléatoire (identifiant machine illisible : hachages NON comparables entre deux passages)'
  return [Convert]::ToBase64String($b)
}
$script:SourceSel = ''
$script:Hmac = [System.Security.Cryptography.HMACSHA256]::new([System.Text.Encoding]::UTF8.GetBytes((Get-Sel)))
$script:Revelations = @{}   # hachage -> nom, seulement avec -AfficherNoms, affiché à l'écran, jamais écrit

function Hache([string]$s) {
  if ($null -eq $s) { $s = '' }
  $b = $script:Hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($s.TrimEnd('\', '/').ToLowerInvariant()))
  $h = ('h-' + $b[0].ToString('x2') + $b[1].ToString('x2') + $b[2].ToString('x2') + $b[3].ToString('x2'))
  if ($AfficherNoms -and $s.Length -le 300 -and -not $script:Revelations.ContainsKey($h)) { $script:Revelations[$h] = $s }
  return $h
}
function Nom([string]$s) { return (Hache $s) }
function Joindre([string]$a, [string]$b) { return [System.IO.Path]::Combine($a, $b) }

# Chemins standard affichés sous une forme neutre ; tout le reste est masqué.
$script:CheminsConnus = @{}
foreach ($rel in '.claude', '.t3', '.codex', '.remy', '.claude.json') {
  $script:CheminsConnus[(Joindre $Profil $rel).TrimEnd('\', '/').ToLowerInvariant()] = '%USERPROFILE%\' + $rel
}
function Chemin([string]$p) {
  if ([string]::IsNullOrEmpty($p)) { return '(vide)' }
  $n = $p.TrimEnd('\', '/').ToLowerInvariant()
  if ($script:CheminsConnus.ContainsKey($n)) { return $script:CheminsConnus[$n] }
  return ('chemin masqué ' + (Hache $p))
}
function NomStandard([string]$nom, [string[]]$liste) {
  # Nom de premier niveau : en clair s'il est standard, haché sinon (un fichier peut porter le nom d'un client).
  if ($liste -contains $nom) { return $nom }
  return ('autre:' + (Hache $nom))
}
function NettoieMessage([string]$m) {
  # Retire tout chemin d'un message d'erreur avant de l'écrire.
  if ($null -eq $m) { return '' }
  $m = [regex]::Replace($m, '[A-Za-z]:\\[^''"\r\n]*', '(chemin masqué)')
  $m = [regex]::Replace($m, '\\\\[^''"\r\n]*', '(chemin masqué)')
  $m = [regex]::Replace($m, '(?<![A-Za-z0-9])/[^\s''"]+/[^\s''"]*', '(chemin masqué)')
  if ($m.Length -gt 200) { $m = $m.Substring(0, 200) + '...' }
  return $m
}
function Valeur($v, [string]$genre = '') {
  # Liste blanche : nombres, versions, valeurs connues de Claude Code et de T3 amont ; motifs de modèle
  # ou d'entrypoint seulement pour ces champs. Toute autre valeur courte devient « autre:h-xxxxxxxx »
  # (comptable, jamais lisible) ; un texte long ou multiligne n'est même pas haché.
  if ($null -eq $v) { return '(absent)' }
  if ($v -is [bool]) { return $v.ToString().ToLowerInvariant() }
  $s = [string]$v
  if ($s -match '^\d+(\.\d+){0,3}$') { return $s }
  if ($s -match '^\d+\.\d+\.\d+([-+.][0-9A-Za-z.\-]{1,24})?$') { return $s }
  if ($script:Connus.Contains($s)) { return $s }
  if ($genre -eq 'entrypoint' -and $s -match '^remote_[a-z]{1,20}$') { return $s }
  if ($genre -eq 'modele' -and $s -match '^(claude|gpt|o[0-9]|codex|glm|qwen)-?[a-z0-9][a-z0-9.\-]{0,40}$' -and -not $script:RxUuid.IsMatch($s)) { return $s }
  if ($s.Length -gt 80 -or $s -match '\s{2,}|[\r\n]') { return '(valeur non affichée)' }
  return ('autre:' + (Hache $s))
}
function Cle([string]$k) {
  if ($k -match '^[A-Za-z_$@][A-Za-z0-9_\-]{0,47}$' -and -not $script:RxUuid.IsMatch($k)) { return $k }
  return '(clé non affichée)'
}
function NomOutil($n) {
  $s = [string]$n
  if ($s.StartsWith('mcp__')) { return 'mcp__(serveur masqué)' }
  return (Valeur $s)
}
function Portee([string]$p) {
  switch ($p) { 'Process' { 'processus' } 'User' { 'utilisateur' } 'Machine' { 'machine' } default { $p } }
}
function Taille([double]$o) {
  if ($o -ge 1GB) { return ('{0:N2} Go' -f ($o / 1GB)) }
  if ($o -ge 1MB) { return ('{0:N1} Mo' -f ($o / 1MB)) }
  if ($o -ge 1KB) { return ('{0:N0} Ko' -f ($o / 1KB)) }
  return ('{0} o' -f $o)
}
function DateCourte($d) { if ($null -eq $d) { return '(n/a)' }; return $d.ToString('yyyy-MM-dd') }   # au jour : pas d'heure ni de fuseau
function AgeJours($d) { if ($null -eq $d) { return $null }; return [int][Math]::Floor(((Get-Date) - $d).TotalDays) }
function Incr([hashtable]$h, $k, [long]$n = 1) {
  $k = [string]$k
  if ($h.ContainsKey($k)) { $h[$k] = $h[$k] + $n } else { $h[$k] = $n }
}
function EcrireComptes([hashtable]$h, [string]$prefixe = '    ', [int]$max = 40) {
  if ($null -eq $h -or $h.Count -eq 0) { Ecrire ($prefixe + '(aucun)'); return }
  $i = 0
  foreach ($e in ($h.GetEnumerator() | Sort-Object -Property @{ Expression = { $_.Value }; Descending = $true }, @{ Expression = { $_.Key }; Descending = $false })) {
    if ($i -ge $max) { Ecrire ($prefixe + '... et ' + ($h.Count - $max) + ' autres'); break }
    Ecrire ('{0}{1} : {2}' -f $prefixe, $e.Key, $e.Value)
    $i++
  }
}
function ListeCles([hashtable]$h) {
  if ($null -eq $h -or $h.Count -eq 0) { return '(aucune)' }
  return (($h.GetEnumerator() | Sort-Object -Property @{ Expression = { $_.Value }; Descending = $true }, @{ Expression = { $_.Key }; Descending = $false } |
    ForEach-Object { $_.Key }) -join ', ')
}
function VersDate($v) {
  if ($null -eq $v) { return $null }
  if ($v -is [datetime]) { return $v.ToUniversalTime() }
  if ($v -is [datetimeoffset]) { return $v.UtcDateTime }
  if ($v -is [string]) {
    $d = [datetime]::MinValue
    if ([datetime]::TryParse($v, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::RoundtripKind, [ref]$d)) { return $d.ToUniversalTime() }
    return $null
  }
  try {
    $n = [double]$v
    if ($n -gt 1e12) { return [DateTimeOffset]::FromUnixTimeMilliseconds([long]$n).UtcDateTime }
    if ($n -gt 1e9) { return [DateTimeOffset]::FromUnixTimeSeconds([long]$n).UtcDateTime }
  } catch {}
  return $null
}

$script:PrefixeLongOk = $false
if ($script:EstWindows) { try { $script:PrefixeLongOk = [System.IO.Directory]::Exists('\\?\' + $Profil) } catch { $script:PrefixeLongOk = $false } }
function Long([string]$p) {
  # Chemins de plus de 240 caractères (dossiers de projets Claude jusqu'à 200 caractères) : préfixe \\?\ sous Windows,
  # seulement si ce .NET l'accepte (testé au démarrage ; ancienne gestion des chemins possible sous PowerShell 5.1).
  if ($script:PrefixeLongOk -and $p -and $p.Length -ge 240 -and -not $p.StartsWith('\\')) { return ('\\?\' + $p) }
  return $p
}
function Ouvrir([string]$p) {
  # Lecture seule, partage complet : n'empêche jamais l'application d'écrire, renommer ou supprimer.
  return [System.IO.FileStream]::new((Long $p), [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, $script:Partage, 65536)
}
function LecteurTexte([string]$p) {
  $fs = Ouvrir $p
  return [System.IO.StreamReader]::new($fs, [System.Text.Encoding]::UTF8, $true, 65536)
}
function LireJsonFichier([string]$p, [long]$max = 5MB) {
  # Petits fichiers JSON uniquement (réglages, métadonnées). Le contenu n'est jamais affiché.
  try {
    $fi = [System.IO.FileInfo]::new((Long $p))
    if (-not $fi.Exists -or $fi.Length -gt $max) { return $null }
    $sr = LecteurTexte $p
    try { $t = $sr.ReadToEnd() } finally { $sr.Dispose() }
    if ([string]::IsNullOrWhiteSpace($t)) { return $null }
    return (ConvertFrom-Json -InputObject $t -ErrorAction Stop)
  } catch { return $null }
}
function EstObjet($o) { return ($o -is [System.Management.Automation.PSCustomObject]) }
function Proprietes($o) { if (EstObjet $o) { return @($o.PSObject.Properties) }; return @() }

function NoteErreurDossier([string]$d, $err) {
  if (-not [System.IO.Directory]::Exists((Long $d))) { return }
  $script:ErreursDossiers++
  if ($script:ErreursDossiers -le 5) { $script:Avertissements.Add('dossier illisible : ' + (NettoieMessage $err.Exception.Message)) }
}
function Fichiers([string]$d, [string]$motif = '*') {
  try { return @([System.IO.DirectoryInfo]::new((Long $d)).GetFiles($motif)) } catch { NoteErreurDossier $d $_; return @() }
}
function SousDossiers([string]$d) {
  try {
    return @([System.IO.DirectoryInfo]::new((Long $d)).GetDirectories() |
      Where-Object { ($_.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0 })
  } catch { NoteErreurDossier $d $_; return @() }
}
function MesureDossier([string]$d, [int]$maxFichiers = 200000, [int]$profMax = 12) {
  # Taille et nombre de fichiers, sans suivre les liens ni les jonctions.
  $r = @{ Fichiers = 0; Octets = [long]0; Tronque = $false; Recent = $null; Ancien = $null; Secrets = $false }
  $pile = New-Object System.Collections.Generic.Stack[object]
  $pile.Push(@($d, 0))
  while ($pile.Count -gt 0) {
    $e = $pile.Pop()
    $items = @()
    try { $items = [System.IO.DirectoryInfo]::new((Long ([string]$e[0]))).GetFileSystemInfos() } catch { continue }
    foreach ($it in $items) {
      if (($it.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
      if ($it -is [System.IO.DirectoryInfo]) {
        if ($it.Name -eq 'secrets') { $r.Secrets = $true; continue }   # jamais parcouru
        if ([int]$e[1] -lt $profMax) { $pile.Push(@($it.FullName, ([int]$e[1] + 1))) }
      } else {
        $r.Fichiers++
        $r.Octets += $it.Length
        if ($null -eq $r.Recent -or $it.LastWriteTime -gt $r.Recent) { $r.Recent = $it.LastWriteTime }
        if ($null -eq $r.Ancien -or $it.LastWriteTime -lt $r.Ancien) { $r.Ancien = $it.LastWriteTime }
        if ($r.Fichiers -ge $maxFichiers) { $r.Tronque = $true; return $r }
      }
    }
  }
  return $r
}
function DecrireFichier([string]$p, [string]$libelle) {
  $fi = [System.IO.FileInfo]::new($p)
  if ($fi.Exists) { Ecrire ('  {0} : {1}, modifié le {2}' -f $libelle, (Taille $fi.Length), (DateCourte $fi.LastWriteTime)) }
  else { Ecrire ('  {0} : absent' -f $libelle) }
}
function LireVariable([string]$nom) {
  $res = New-Object System.Collections.Generic.List[object]
  foreach ($portee in 'Process', 'User', 'Machine') {
    $v = $null
    try { $v = [Environment]::GetEnvironmentVariable($nom, $portee) } catch {}
    if (-not [string]::IsNullOrEmpty($v)) { $res.Add([pscustomobject]@{ Portee = $portee; Valeur = $v }) }
  }
  return , $res
}
function AjouteRacine($liste, [string]$chemin, [string]$origine) {
  if ([string]::IsNullOrEmpty($chemin)) { return }
  $n = $chemin.TrimEnd('\', '/')
  foreach ($r in $liste) {
    if ([string]::Equals($r.Chemin, $n, [System.StringComparison]::OrdinalIgnoreCase)) {
      if ($r.Origine -notlike ('*' + $origine + '*')) { $r.Origine = $r.Origine + ' + ' + $origine }
      return
    }
  }
  $liste.Add([pscustomobject]@{ Chemin = $n; Origine = $origine; Retention = $null; Invalide = $false })
}
function QuoteArg([string]$a) {
  # Règles de découpage de la ligne de commande Windows (guillemets et barres obliques inverses).
  if ($a -eq '') { return '""' }
  if ($a -notmatch '[\s"]') { return $a }
  $sb = New-Object System.Text.StringBuilder
  [void]$sb.Append('"')
  $bs = 0
  foreach ($ch in $a.ToCharArray()) {
    if ($ch -eq [char]'\') { $bs++; continue }
    if ($ch -eq [char]'"') { [void]$sb.Append(('\' * ($bs * 2 + 1))); [void]$sb.Append('"'); $bs = 0; continue }
    if ($bs -gt 0) { [void]$sb.Append(('\' * $bs)); $bs = 0 }
    [void]$sb.Append($ch)
  }
  [void]$sb.Append(('\' * ($bs * 2)))
  [void]$sb.Append('"')
  return $sb.ToString()
}
function Lance([string]$exe, [string[]]$arguments, [string]$entree = $null, [int]$delaiMs = 60000) {
  # Lance un programme en lecture (sqlite3, git, node) sans console, sorties capturées en UTF-8.
  try {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $exe
    $psi.Arguments = (@($arguments | ForEach-Object { QuoteArg $_ }) -join ' ')
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.RedirectStandardInput = $true
    $psi.CreateNoWindow = $true
    $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
    $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8
    $p = [System.Diagnostics.Process]::Start($psi)
    $tacheSortie = $p.StandardOutput.ReadToEndAsync()
    $tacheErreur = $p.StandardError.ReadToEndAsync()
    if ($entree) { $p.StandardInput.Write($entree) }
    $p.StandardInput.Close()
    if (-not $p.WaitForExit($delaiMs)) {
      try { $p.Kill() } catch {}
      return @{ Code = -1; Sortie = ''; Erreur = 'délai dépassé' }
    }
    $p.WaitForExit()
    return @{ Code = $p.ExitCode; Sortie = $tacheSortie.Result; Erreur = $tacheErreur.Result }
  } catch {
    return @{ Code = -2; Sortie = ''; Erreur = (NettoieMessage $_.Exception.Message) }
  }
}
function TrouveProgramme([string[]]$noms) {
  foreach ($n in $noms) {
    $c = Get-Command -Name $n -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c) { return $c.Path }
  }
  return $null
}

# Catégorie d'une session d'après son cwd (jamais affiché) ou, à défaut, d'après le nom du dossier projet.
function CategorieCwd([string]$cwd, [string]$slug) {
  if (-not [string]::IsNullOrEmpty($cwd)) {
    if ($cwd -match 'remy-claude-[^\\/]+[\\/]+vide$') { return 'remy-claude-p' }
    if ($cwd -match 't3code-claude-title-') { return 't3-titres' }
    if ($cwd -match '[\\/]\.t3[\\/]+worktrees[\\/]') { return 't3-worktree' }
    if ($cwd -match '[\\/](Temp|tmp)[\\/]') { return 'temporaire' }
    return 'projet'
  }
  if ($slug -match 'remy-claude-[A-Za-z0-9]+-vide$') { return 'remy-claude-p' }
  if ($slug -match 't3code-claude-title-') { return 't3-titres' }
  if ($slug -match '--t3-worktrees-') { return 't3-worktree' }
  if ($slug -match '-(Temp|tmp)-') { return 'temporaire' }
  return 'projet'
}

# ---------------------------------------------------------------------------
# 1. En-tête et environnement
# ---------------------------------------------------------------------------
function EnTete {
  Titre 'Audit des sources de sessions - LECTURE SEULE'
  Ecrire '  Noms, chemins et valeurs hors liste blanche masqués (h-xxxxxxxx : hachage salé).'
  Ecrire ('  Sel du hachage : {0}' -f $script:SourceSel)
  Ecrire ('  Date : {0}' -f (Get-Date -Format 'yyyy-MM-dd'))
  Ecrire ('  PowerShell : {0} ({1})' -f $PSVersionTable.PSVersion, $PSVersionTable.PSEdition)
  try { $ov = [Environment]::OSVersion.Version; Ecrire ('  Système : {0} {1}.{2}' -f [Environment]::OSVersion.Platform, $ov.Major, $ov.Minor) } catch {}
  if ($script:EstWindows) {
    $lp = '(illisible)'
    try { $lp = [string](Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -ErrorAction Stop).LongPathsEnabled } catch {}
    Ecrire ('  Chemins longs : LongPathsEnabled = {0} ; préfixe \\?\ accepté par ce .NET : {1}' -f $lp, $script:PrefixeLongOk)
  }
  Ecrire ('  Options : Echantillon={0}, MaxLignes={1}, Projet={2}, Moteur={3}, CopieT3={4}, WSL={5}, DepotFork={6}' -f $Echantillon, $MaxLignes, (-not [string]::IsNullOrEmpty($Projet)), $Moteur, [bool]$CopieT3, [bool]$WSL, (-not [string]::IsNullOrEmpty($DepotFork)))
  Ecrire '  Ce rapport ne contient ni texte de message, ni résultat d''outil, ni valeur de réglage libre (seuls cleanupPeriodDays et des interrupteurs 0/1 sont affichés), ni heure.'

  SousTitre 'Processus en cours (noms standard seulement)'
  $procs = @{}
  try {
    foreach ($p in (Get-Process -ErrorAction SilentlyContinue)) {
      $n = $p.ProcessName
      if ($n -match '(?i)^(claude|codex|node|ollama)$') { Incr $procs $n.ToLowerInvariant() }
      elseif ($n -match '(?i)^t3[ ._-]?code') { Incr $procs 't3code (application)'; $script:ProcT3 = $true }
      elseif ($n -match '(?i)claude|codex|t3') { Incr $procs 'autre (nom masqué)' }
    }
  } catch {}
  EcrireComptes $procs '    '
}

# ---------------------------------------------------------------------------
# 2. Réglages de T3 Code : chemins Claude/Codex éventuellement personnalisés
# ---------------------------------------------------------------------------
function ChercheCles($o, [string]$chemin, [string[]]$noms, $res, [int]$prof = 0) {
  if ($null -eq $o -or $prof -gt 10) { return }
  if (EstObjet $o) {
    foreach ($pp in $o.PSObject.Properties) {
      $c = $chemin + '.' + $pp.Name
      if ($noms -contains $pp.Name) { $res.Add([pscustomobject]@{ Chemin = $c; Cle = $pp.Name; Valeur = $pp.Value }) }
      ChercheCles $pp.Value $c $noms $res ($prof + 1)
    }
  } elseif ($o -is [System.Array]) {
    $i = 0
    foreach ($e in $o) { ChercheCles $e ($chemin + '[' + $i + ']') $noms $res ($prof + 1); $i++ }
  }
}
function RacinesT3 {
  $liste = New-Object System.Collections.Generic.List[object]
  foreach ($v in (LireVariable 'T3CODE_HOME')) { AjouteRacine $liste $v.Valeur ('T3CODE_HOME ' + (Portee $v.Portee)) }
  AjouteRacine $liste (Joindre $Profil '.t3') 'défaut'
  # Fork lancé depuis les sources (vp run dev) : <dépôt ou worktree lié>\.t3\userdata (scripts/dev-runner.ts amont).
  if ($DepotFork) {
    AjouteRacine $liste (Joindre $DepotFork '.t3') 'dépôt du fork (sources)'
    foreach ($wt in $script:WorktreesFork) { AjouteRacine $liste (Joindre $wt '.t3') 'worktree lié du fork (sources)' }
  }
  return , $liste
}
function ListeWorktreesFork {
  # git worktree list ne fait que lire ; les chemins ne sont jamais affichés.
  $script:WorktreesFork = New-Object System.Collections.Generic.List[string]
  if (-not $DepotFork -or -not [System.IO.Directory]::Exists((Long $DepotFork))) { return }
  $git = TrouveProgramme @('git.exe', 'git')
  if (-not $git) { return }
  $r = Lance $git @('-C', $DepotFork, 'worktree', 'list', '--porcelain') $null 20000
  foreach ($l in ($r.Sortie -split "`n")) {
    $l = $l.TrimEnd("`r")
    if ($l.StartsWith('worktree ')) {
      $p = $l.Substring(9).Trim()
      if ($script:EstWindows) { $p = $p.Replace('/', '\') }
      if (-not [string]::Equals($p.TrimEnd('\', '/'), $DepotFork.TrimEnd('\', '/'), [System.StringComparison]::OrdinalIgnoreCase)) { $script:WorktreesFork.Add($p) }
    }
  }
}
function DecouvreReglagesT3 {
  # Lit uniquement les clés homePath / shadowHomePath / binaryPath de settings.json (valeurs jamais affichées).
  $script:ReglagesT3 = New-Object System.Collections.Generic.List[object]
  foreach ($r in (RacinesT3)) {
    foreach ($sous in 'userdata', 'dev') {
      $f = Joindre (Joindre $r.Chemin $sous) 'settings.json'
      if (-not [System.IO.File]::Exists((Long ($f)))) { continue }
      $j = LireJsonFichier $f
      if ($null -eq $j) { continue }
      $res = New-Object System.Collections.Generic.List[object]
      ChercheCles $j '' @('homePath', 'shadowHomePath', 'binaryPath') $res
      $wsl = New-Object System.Collections.Generic.List[object]
      foreach ($pp in (Proprietes $j)) { if ($pp.Name -match '(?i)wsl|backend') { $wsl.Add($pp.Name) } }
      foreach ($e in $res) {
        $genre = 'inconnu'
        if ($e.Chemin -match '(?i)claude') { $genre = 'claude' } elseif ($e.Chemin -match '(?i)codex') { $genre = 'codex' }
        $val = [string]$e.Valeur
        if ($genre -eq 'inconnu' -and $e.Cle -ne 'binaryPath' -and $val) {
          if ([System.IO.Directory]::Exists((Long ((Joindre $val 'projects'))))) { $genre = 'claude' }
          elseif ([System.IO.Directory]::Exists((Long ((Joindre $val 'sessions'))))) { $genre = 'codex' }
        }
        $script:ReglagesT3.Add([pscustomobject]@{ Fichier = $f; Cle = $e.Cle; Genre = $genre; Valeur = $val; Sous = $sous; ClesWsl = ($wsl -join ', ') })
      }
      if ($res.Count -eq 0 -and $wsl.Count -gt 0) {
        $script:ReglagesT3.Add([pscustomobject]@{ Fichier = $f; Cle = ''; Genre = ''; Valeur = ''; Sous = $sous; ClesWsl = ($wsl -join ', ') })
      }
    }
  }
}

# ---------------------------------------------------------------------------
# 3. Claude Code
# ---------------------------------------------------------------------------
function LireReglagesClaude([string]$f, [string]$libelle, $racine = $null) {
  if (-not [System.IO.File]::Exists((Long ($f)))) { Ecrire ('  {0} : absent' -f $libelle); return }
  $j = LireJsonFichier $f
  if ($null -eq $j) {
    Ecrire ('  {0} : présent mais illisible ou trop gros (à corriger, contrôle avec /doctor)' -f $libelle)
    if ($racine) { $racine.Invalide = $true }
    return
  }
  $cp = $j.cleanupPeriodDays
  if ($null -ne $cp) {
    Ecrire ('  {0} : cleanupPeriodDays = {1}' -f $libelle, (Valeur $cp))
    try {
      $n = [int]$cp
      if ($racine) { if ($null -eq $racine.Retention -or $n -lt $racine.Retention) { $racine.Retention = $n } } else { $script:RetentionsLues.Add($n) }
    } catch {}
  } else { Ecrire ('  {0} : cleanupPeriodDays non défini (défaut documenté : 30 jours)' -f $libelle) }
  if ($null -ne $j.desktopSessionCleanupPeriodDays) { Ecrire ('    desktopSessionCleanupPeriodDays = {0}' -f (Valeur $j.desktopSessionCleanupPeriodDays)) }
  if (EstObjet $j.hooks) {
    $ev = @($j.hooks.PSObject.Properties | ForEach-Object { Cle $_.Name })
    Ecrire ('    hooks configurés (événements) : {0}' -f ($(if ($ev.Count) { $ev -join ', ' } else { '(aucun)' })))
    foreach ($x in $ev) { $script:HooksVus[$x] = 1 }
  } else { Ecrire '    hooks : aucun' }
  if (EstObjet $j.env) {
    $n = 0
    foreach ($pp in $j.env.PSObject.Properties) {
      if ($pp.Name -in @('CLAUDE_CODE_SKIP_PROMPT_HISTORY', 'CLAUDE_CODE_TRANSCRIPT_LOCAL_GC', 'CLAUDE_CONFIG_DIR', 'DISABLE_TELEMETRY')) {
        $v = [string]$pp.Value
        if ($v -match '^(0|1|true|false)$') { Ecrire ('    env.{0} = {1}' -f $pp.Name, $v) } else { Ecrire ('    env.{0} : défini (valeur masquée)' -f $pp.Name) }
      } else { $n++ }
    }
    Ecrire ('    autres variables dans env : {0} (noms et valeurs non affichés)' -f $n)
  }
  $autres = @($j.PSObject.Properties | Where-Object { $_.Name -notin @('cleanupPeriodDays', 'hooks', 'env') } | ForEach-Object { Cle $_.Name })
  Ecrire ('    autres clés de premier niveau : {0}' -f ($(if ($autres.Count) { $autres -join ', ' } else { '(aucune)' })))
}

function EnTeteSession([string]$p) {
  # Lit au plus 60 lignes (4 Mo) du début de la session pour relever entrypoint, version, cwd, type de la 1re ligne.
  $r = @{ Entrypoint = $null; Version = $null; Cwd = $null; SessionId = $null; PremierType = $null; PremiereCompaction = $false; Erreur = $null }
  $sr = $null
  try {
    $sr = LecteurTexte $p
    $lus = 0; $octets = 0
    while ($null -ne ($l = $sr.ReadLine())) {
      $lus++; $octets += $l.Length
      if ($lus -eq 1) {
        $o = $null
        if ($l.Length -le $script:MaxOctetsLigne) { try { $o = ConvertFrom-Json -InputObject $l -ErrorAction Stop } catch {} }
        if ($null -ne $o) { $r.PremierType = [string]$o.type; if ($o.subtype -eq 'compact_boundary') { $r.PremiereCompaction = $true } }
        else { $m = $script:RxType.Match($l); if ($m.Success) { $r.PremierType = $m.Groups[1].Value } }
      }
      if ($null -eq $r.Entrypoint) { $m = $script:RxEntrypoint.Match($l); if ($m.Success) { $r.Entrypoint = $m.Groups[1].Value } }
      if ($null -eq $r.Version) { $m = $script:RxVersion.Match($l); if ($m.Success) { $r.Version = $m.Groups[1].Value } }
      if ($null -eq $r.SessionId) { $m = $script:RxSessionId.Match($l); if ($m.Success) { $r.SessionId = $m.Groups[1].Value.ToLowerInvariant() } }
      if ($null -eq $r.Cwd) {
        $m = $script:RxCwd.Match($l)
        if ($m.Success) { try { $r.Cwd = [regex]::Unescape($m.Groups[1].Value) } catch { $r.Cwd = $m.Groups[1].Value } }
      }
      if (($r.Entrypoint -and $r.Version -and $r.Cwd -and $r.SessionId) -or $lus -ge 60 -or $octets -ge 4MB) { break }
    }
  } catch { $r.Erreur = NettoieMessage $_.Exception.Message }
  finally { if ($sr) { $sr.Dispose() } }
  return $r
}

function AuditRacineClaude($racine) {
  SousTitre ('Racine Claude Code : {0} (origine : {1})' -f (Chemin $racine.Chemin), $racine.Origine)
  if (-not [System.IO.Directory]::Exists((Long ($racine.Chemin)))) { Ecrire '  absente'; return }

  Ecrire '  Contenu de premier niveau (noms standard en clair, autres hachés ; tailles ; aucun fichier ouvert) :'
  $elements = @()
  try { $elements = [System.IO.DirectoryInfo]::new($racine.Chemin).GetFileSystemInfos() } catch {}
  foreach ($it in ($elements | Sort-Object Name)) {
    $nomAff = NomStandard $it.Name $script:NomsClaude
    if ($it -is [System.IO.DirectoryInfo]) {
      if (($it.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { Ecrire ('    [dossier] {0} : lien ou jonction (non suivi)' -f $nomAff); continue }
      $m = MesureDossier $it.FullName
      Ecrire ('    [dossier] {0} : {1} fichiers, {2}{3}, dernier changement {4}' -f $nomAff, $m.Fichiers, (Taille $m.Octets), ($(if ($m.Tronque) { ' (comptage arrêté)' } else { '' })), (DateCourte $m.Recent))
    } else {
      Ecrire ('    [fichier] {0} : {1}, modifié le {2}' -f $nomAff, (Taille $it.Length), (DateCourte $it.LastWriteTime))
    }
  }

  Ecrire '  Réglages (seules quelques clés sont lues ; aucune valeur libre affichée) :'
  LireReglagesClaude (Joindre $racine.Chemin 'settings.json') 'settings.json' $racine
  LireReglagesClaude (Joindre $racine.Chemin 'settings.local.json') 'settings.local.json' $racine

  # Processus Claude Code vivants : sessions\<pid>.json
  $dSessions = Joindre $racine.Chemin 'sessions'
  $fs = Fichiers $dSessions '*.json'
  Ecrire ('  sessions\*.json (sessions ouvertes) : {0} fichier(s)' -f $fs.Count)
  if ($fs.Count -gt 0) {
    $cles = @{}; $statuts = @{}; $genres = @{}; $entrees = @{}
    foreach ($f in ($fs | Select-Object -First 50)) {
      $j = LireJsonFichier $f.FullName 1MB
      foreach ($pp in (Proprietes $j)) { Incr $cles (Cle $pp.Name) }
      if ($null -ne $j) { Incr $statuts (Valeur $j.status); Incr $genres (Valeur $j.kind); Incr $entrees (Valeur $j.entrypoint 'entrypoint') }
    }
    Ecrire ('    clés : {0}' -f (ListeCles $cles))
    Ecrire ('    status : {0}' -f (ListeCles $statuts))
    Ecrire ('    kind : {0} ; entrypoint : {1}' -f (ListeCles $genres), (ListeCles $entrees))
  }

  # Historique des prompts tapés
  $h = Joindre $racine.Chemin 'history.jsonl'
  if ([System.IO.File]::Exists((Long ($h)))) {
    $fi = [System.IO.FileInfo]::new($h)
    $nb = 0; $premiere = $null; $derniere = $null
    $sr = $null
    try {
      $sr = LecteurTexte $h
      while ($null -ne ($l = $sr.ReadLine())) { $nb++; if ($nb -eq 1) { $premiere = $l }; $derniere = $l }
    } catch {} finally { if ($sr) { $sr.Dispose() } }
    Ecrire ('  history.jsonl : {0} lignes, {1}, modifié le {2}' -f $nb, (Taille $fi.Length), (DateCourte $fi.LastWriteTime))
    foreach ($paire in @(@('première', $premiere), @('dernière', $derniere))) {
      $l = $paire[1]
      if ($l -and $l.Length -le $script:MaxOctetsLigne) {
        try {
          $o = ConvertFrom-Json -InputObject $l -ErrorAction Stop
          $k = @($o.PSObject.Properties | ForEach-Object { Cle $_.Name }) -join ', '
          $d = $null
          foreach ($nomDate in 'timestamp', 'createdAt', 'time') { if ($null -eq $d -and $null -ne $o.$nomDate) { $d = VersDate $o.$nomDate } }
          Ecrire ('    {0} ligne : clés = {1} ; date = {2}' -f $paire[0], $k, (DateCourte $d))
          if ($null -ne $d) { if ($null -eq $script:HistoriqueAncien -or $d -lt $script:HistoriqueAncien) { $script:HistoriqueAncien = $d } }
        } catch { Ecrire ('    {0} ligne : illisible' -f $paire[0]) }
      }
    }
  } else { Ecrire '  history.jsonl : absent' }

  # Projets et sessions
  $dProjets = Joindre $racine.Chemin 'projects'
  if (-not [System.IO.Directory]::Exists((Long ($dProjets)))) { Ecrire '  projects\ : absent'; return }
  $lignesProjets = New-Object System.Collections.Generic.List[object]
  foreach ($dp in (SousDossiers $dProjets)) {
    $sessions = @(Fichiers $dp.FullName '*.jsonl' | Where-Object { $_.Name.EndsWith('.jsonl', [System.StringComparison]::OrdinalIgnoreCase) })
    $deCote = @(Fichiers $dp.FullName '*' | Where-Object { $_.Name -match '\.jsonl\.' }).Count
    $nbSousAgents = 0; $nbAgentsWf = 0; $nbToolResults = 0; $octetsAnnexes = [long]0; $nbMemoire = 0
    foreach ($sd in (SousDossiers $dp.FullName)) {
      if ($sd.Name -eq 'memory') { $nbMemoire += @(Fichiers $sd.FullName '*.md').Count; continue }
      $dsa = Joindre $sd.FullName 'subagents'
      if ([System.IO.Directory]::Exists((Long ($dsa)))) {
        $m = MesureDossier $dsa 50000 4
        $nbSousAgents += @(Fichiers $dsa 'agent-*.jsonl').Count
        # Sous-agents de workflow : subagents\workflows\<wf>\agent-*.jsonl (+ journal.jsonl), sans toolUseId.
        foreach ($dwf in (SousDossiers (Joindre $dsa 'workflows'))) {
          $nbAgentsWf += @(Fichiers $dwf.FullName 'agent-*.jsonl').Count
          if ([System.IO.File]::Exists((Long (Joindre $dwf.FullName 'journal.jsonl')))) { $script:NbJournauxWf++ }
        }
        $octetsAnnexes += $m.Octets
      }
      $dtr = Joindre $sd.FullName 'tool-results'
      if ([System.IO.Directory]::Exists((Long ($dtr)))) {
        $ftr = Fichiers $dtr
        $nbToolResults += $ftr.Count
        foreach ($x in $ftr) { $octetsAnnexes += $x.Length }
      }
    }
    $octets = [long]0; $ancien = $null; $recent = $null
    $cwds = @{}; $cats = @{}
    foreach ($s in $sessions) {
      $octets += $s.Length
      if ($null -eq $ancien -or $s.LastWriteTime -lt $ancien) { $ancien = $s.LastWriteTime }
      if ($null -eq $recent -or $s.LastWriteTime -gt $recent) { $recent = $s.LastWriteTime }
      $e = EnTeteSession $s.FullName
      $cat = CategorieCwd $e.Cwd $dp.Name
      Incr $cats $cat
      if ($e.Cwd) { $cwds[(Hache $e.Cwd)] = 1 }
      $idFichier = [System.IO.Path]::GetFileNameWithoutExtension($s.Name).ToLowerInvariant()
      $script:SessionsClaude.Add([pscustomobject]@{
          Racine = $racine.Chemin; Projet = $dp.Name; Chemin = $s.FullName; Taille = $s.Length; Modif = $s.LastWriteTime
          Id = $idFichier; SessionIdLigne = $e.SessionId; Entrypoint = $e.Entrypoint; Version = $e.Version
          Categorie = $cat; PremierType = $e.PremierType; PremiereCompaction = $e.PremiereCompaction; Erreur = $e.Erreur
        })
      $script:IdsClaude[$idFichier] = $script:SessionsClaude.Count - 1
    }
    $catPrincipale = 'vide'
    if ($cats.Count -gt 0) { $catPrincipale = ($cats.GetEnumerator() | Sort-Object -Property @{ Expression = { $_.Value }; Descending = $true } | Select-Object -First 1).Key }
    $lignesProjets.Add([pscustomobject]@{
        Nom = (Nom $dp.Name); Categorie = $catPrincipale; Sessions = $sessions.Count; Octets = $octets; Ancien = $ancien; Recent = $recent
        SousAgents = ('{0}+{1}wf' -f $nbSousAgents, $nbAgentsWf); ToolResults = $nbToolResults; OctetsAnnexes = $octetsAnnexes; DeCote = $deCote; Cwds = $cwds.Count; Memoire = $nbMemoire
      })
    $script:NbSousAgents += $nbSousAgents; $script:NbAgentsWf += $nbAgentsWf
  }
  Ecrire ('  projects\ : {0} dossier(s) de projet' -f $lignesProjets.Count)
  Ecrire '    projet       catégorie      sessions   taille    plus ancienne  ( âge)  plus récente  sous-agents  tool-results  annexes   mises de côté  cwd distincts  mémoire auto'
  $i = 0
  foreach ($lp in ($lignesProjets | Sort-Object -Property @{ Expression = { if ($_.Recent) { $_.Recent } else { [datetime]::MinValue } }; Descending = $true })) {
    $i++
    if ($i -gt 300) { Ecrire ('    ... et {0} autres projets' -f ($lignesProjets.Count - 300)); break }
    $age = AgeJours $lp.Ancien
    Ecrire ('    {0,-12} {1,-14} {2,8}  {3,9}  {4} ({5,4} j)  {6}  {7,11}  {8,12}  {9,8}  {10,13}  {11,13}  {12,12}' -f `
        $lp.Nom, $lp.Categorie, $lp.Sessions, (Taille $lp.Octets), (DateCourte $lp.Ancien), $age, (DateCourte $lp.Recent), `
        $lp.SousAgents, $lp.ToolResults, (Taille $lp.OctetsAnnexes), $lp.DeCote, $lp.Cwds, $lp.Memoire)
  }
}

function SyntheseClaude {
  SousTitre 'Sessions Claude Code : vue d''ensemble'
  $tout = $script:SessionsClaude
  if ($tout.Count -eq 0) { Ecrire '  Aucune session trouvée.'; return }
  $octets = [long]0; foreach ($s in $tout) { $octets += $s.Taille }
  $ancienne = ($tout | Sort-Object Modif | Select-Object -First 1)
  $recente = ($tout | Sort-Object Modif -Descending | Select-Object -First 1)
  $script:AgeMax = AgeJours $ancienne.Modif
  Ecrire ('  Sessions : {0} ; taille totale : {1}' -f $tout.Count, (Taille $octets))
  Ecrire ('  Plus ancienne (date de dernière écriture) : {0}, il y a {1} jours' -f (DateCourte $ancienne.Modif), $script:AgeMax)
  Ecrire ('  Plus récente : {0}' -f (DateCourte $recente.Modif))
  $tranches = [ordered]@{ '< 7 j' = 0; '7-14 j' = 0; '14-30 j' = 0; '30-90 j' = 0; '> 90 j' = 0 }
  $mois = @{}
  foreach ($s in $tout) {
    $a = AgeJours $s.Modif
    if ($a -lt 7) { $tranches['< 7 j']++ } elseif ($a -lt 14) { $tranches['7-14 j']++ } elseif ($a -lt 30) { $tranches['14-30 j']++ } elseif ($a -lt 90) { $tranches['30-90 j']++ } else { $tranches['> 90 j']++ }
    Incr $mois ($s.Modif.ToString('yyyy-MM'))
  }
  Ecrire ('  Par âge : ' + (($tranches.GetEnumerator() | ForEach-Object { '{0} = {1}' -f $_.Key, $_.Value }) -join ' ; '))
  Ecrire ('  Par mois : ' + (($mois.GetEnumerator() | Sort-Object Key | ForEach-Object { '{0} = {1}' -f $_.Key, $_.Value }) -join ' ; '))

  $ep = @{}; $cat = @{}; $ver = @{}; $prem = @{}; $nbCompaction = 0; $nbIdDiff = 0; $nbErreurs = 0; $epParCat = @{}
  foreach ($s in $tout) {
    $e = Valeur $s.Entrypoint 'entrypoint'
    Incr $ep $e
    Incr $cat $s.Categorie
    Incr $epParCat ($s.Categorie + ' / ' + $e)
    # claude -p lancé dans un dossier de projet : générations de T3 (commits, PR, branches, revues) ou tes propres scripts.
    if ($s.Entrypoint -eq 'sdk-cli' -and ($s.Categorie -eq 'projet' -or $s.Categorie -eq 't3-worktree')) { $script:NbSdkCliProjet++ }
    if ($s.Categorie -eq 'temporaire') { $script:NbTemporaires++ }
    if ($s.Version) { Incr $ver (Valeur $s.Version) }
    Incr $prem (Valeur $s.PremierType)
    if ($s.PremiereCompaction) { $nbCompaction++ }
    if ($s.SessionIdLigne -and $s.SessionIdLigne -ne $s.Id) { $nbIdDiff++ }
    if ($s.Erreur) { $nbErreurs++ }
  }
  Ecrire '  entrypoint (1re occurrence par session) :'; EcrireComptes $ep '    '
  Ecrire '  Catégorie d''après le cwd (jamais affiché) :'; EcrireComptes $cat '    '
  Ecrire '  Catégorie / entrypoint :'; EcrireComptes $epParCat '    '
  Ecrire '  Version de Claude Code (1re occurrence par session, 15 plus fréquentes) :'; EcrireComptes $ver '    ' 15
  Ecrire '  Type de la première ligne :'; EcrireComptes $prem '    '
  Ecrire ('  Sessions commençant par une compaction (copie partielle, ex. ramenée du cloud) : {0}' -f $nbCompaction)
  Ecrire ('  Sessions dont le sessionId des lignes diffère du nom de fichier : {0}' -f $nbIdDiff)
  if ($nbErreurs) { Avert ('{0} session(s) illisible(s) (verrou ou droits)' -f $nbErreurs) }
  $script:NbRemy = 0; if ($cat.ContainsKey('remy-claude-p')) { $script:NbRemy = $cat['remy-claude-p'] }
  $script:NbTitresT3 = 0; if ($cat.ContainsKey('t3-titres')) { $script:NbTitresT3 = $cat['t3-titres'] }
  $script:NbWorktreesT3 = 0; if ($cat.ContainsKey('t3-worktree')) { $script:NbWorktreesT3 = $cat['t3-worktree'] }
}

function AnalyseEchantillon {
  SousTitre ('Échantillon : structure détaillée des {0} sessions les plus récentes (hors appels de Rémy et titres T3)' -f $Echantillon)
  if ($Echantillon -le 0) { Ecrire '  (désactivé)'; return }
  $candidates = @($script:SessionsClaude | Where-Object { $_.Categorie -ne 'remy-claude-p' -and $_.Categorie -ne 't3-titres' })
  if ($Projet) {
    $candidates = @($candidates | Where-Object { (Hache $_.Projet) -eq $Projet })
    Ecrire ('  limité au projet {0} (option -Projet) : {1} session(s)' -f $Projet, $candidates.Count)
  }
  $choix = @($candidates | Sort-Object Modif -Descending | Select-Object -First $Echantillon)
  if ($choix.Count -eq 0) { Ecrire '  Aucune session éligible.'; return }
  $st = @{ Types = @{}; SousTypes = @{}; ClesParType = @{}; ClesMessage = @{}; Blocs = @{}; ClesBlocs = @{}; Outils = @{}; Entrypoints = @{};
    Versions = @{}; Origines = @{}; ClesOrigin = @{}; Roles = @{}; Arrets = @{}; Modeles = @{}; ClesToolUseResult = @{}; ClesCompact = @{} }
  $c = [ordered]@{ Fichiers = 0; Lignes = 0; Vides = 0; Illisibles = 0; TropGrosses = 0; FichiersTronques = 0; IsMeta = 0; IsCompactSummary = 0;
    IsSidechain = 0; ToolUseResult = 0; CompactBoundary = 0; PersistedOutput = 0; Images = 0; SecretsSuspects = 0; ReculsHorodatage = 0;
    LignesAssistant = 0; MessageIdsDistincts = 0; MaxLignesParReponse = 0; UuidDoublonsMemeFichier = 0; UuidPartagesEntreFichiers = 0; LignesSansUuid = 0 }
  $uuidGlobal = @{}
  $idx = 0
  foreach ($s in $choix) {
    $idx++
    $c.Fichiers++
    Ecrire ('  session {0} : projet {1}, {2}, modifiée le {3}, catégorie {4}' -f $idx, (Nom $s.Projet), (Taille $s.Taille), (DateCourte $s.Modif), $s.Categorie)
    $uuidLocal = @{}; $msgIds = @{}; $dernier = $null; $n = 0
    $sr = $null
    try {
      $sr = LecteurTexte $s.Chemin
      while ($null -ne ($l = $sr.ReadLine())) {
        $n++
        if ($n -gt $MaxLignes) { $c.FichiersTronques++; break }
        $c.Lignes++
        if ($l.Length -eq 0) { $c.Vides++; continue }
        if ($script:RxSecret.IsMatch($l)) { $c.SecretsSuspects++ }
        if ($l.IndexOf('persisted-output', [System.StringComparison]::Ordinal) -ge 0) { $c.PersistedOutput++ }
        if ($l.Length -gt $script:MaxOctetsLigne) {
          $c.TropGrosses++
          $m = $script:RxType.Match($l.Substring(0, [Math]::Min(4000, $l.Length)))
          if ($m.Success) { Incr $st.Types (Valeur $m.Groups[1].Value) } else { Incr $st.Types '(inconnu)' }
          $c.Images += $script:RxImage.Matches($l).Count
          continue
        }
        $o = $null
        try { $o = ConvertFrom-Json -InputObject $l -ErrorAction Stop } catch { $c.Illisibles++; continue }
        if (-not (EstObjet $o)) { $c.Illisibles++; continue }
        $t = Valeur $o.type
        Incr $st.Types $t
        if (-not $st.ClesParType.ContainsKey($t)) { $st.ClesParType[$t] = @{} }
        foreach ($pp in $o.PSObject.Properties) { Incr $st.ClesParType[$t] (Cle $pp.Name) }
        if ($t -eq 'system') {
          Incr $st.SousTypes (Valeur $o.subtype)
          if ($o.subtype -eq 'compact_boundary') {
            $c.CompactBoundary++
            foreach ($pp in (Proprietes $o.compactMetadata)) { Incr $st.ClesCompact (Cle $pp.Name) }
          }
        }
        if ($null -ne $o.entrypoint) { Incr $st.Entrypoints (Valeur $o.entrypoint 'entrypoint') }
        if ($null -ne $o.version) { Incr $st.Versions (Valeur $o.version) }
        if ($o.isMeta -eq $true) { $c.IsMeta++ }
        if ($o.isCompactSummary -eq $true) { $c.IsCompactSummary++ }
        if ($o.isSidechain -eq $true) { $c.IsSidechain++ }
        if ($null -ne $o.toolUseResult) {
          $c.ToolUseResult++
          foreach ($pp in (Proprietes $o.toolUseResult)) { Incr $st.ClesToolUseResult (Cle $pp.Name) }
        }
        if ($null -ne $o.origin) {
          Incr $st.Origines (Valeur $o.origin.kind)
          foreach ($pp in (Proprietes $o.origin)) { Incr $st.ClesOrigin (Cle $pp.Name) }
        }
        $u = $o.uuid
        if ($u) {
          $u = ([string]$u).ToLowerInvariant()
          if ($uuidLocal.ContainsKey($u)) { $c.UuidDoublonsMemeFichier++ }
          else {
            $uuidLocal[$u] = 1
            if ($uuidGlobal.ContainsKey($u)) { if ($uuidGlobal[$u] -ne $idx) { $c.UuidPartagesEntreFichiers++ } } else { $uuidGlobal[$u] = $idx }
          }
        } else { $c.LignesSansUuid++ }
        $ts = VersDate $o.timestamp
        if ($null -ne $ts) { if ($null -ne $dernier -and $ts -lt $dernier) { $c.ReculsHorodatage++ }; $dernier = $ts }
        $msg = $o.message
        if (EstObjet $msg) {
          if (-not $st.ClesMessage.ContainsKey($t)) { $st.ClesMessage[$t] = @{} }
          foreach ($pp in $msg.PSObject.Properties) { Incr $st.ClesMessage[$t] (Cle $pp.Name) }
          if ($null -ne $msg.role) { Incr $st.Roles (Valeur $msg.role) }
          if ($null -ne $msg.stop_reason) { Incr $st.Arrets (Valeur $msg.stop_reason) }
          if ($null -ne $msg.model) { Incr $st.Modeles (Valeur $msg.model 'modele') }
          if ($t -eq 'assistant') {
            $c.LignesAssistant++
            if ($msg.id) { Incr $msgIds ([string]$msg.id) }
          }
          $contenu = $msg.content
          if ($contenu -is [string]) { Incr $st.Blocs '(texte brut)' }
          elseif ($contenu -is [System.Array]) {
            foreach ($b in $contenu) {
              if (-not (EstObjet $b)) { continue }
              $bt = Valeur $b.type
              Incr $st.Blocs $bt
              if (-not $st.ClesBlocs.ContainsKey($bt)) { $st.ClesBlocs[$bt] = @{} }
              foreach ($pp in $b.PSObject.Properties) { Incr $st.ClesBlocs[$bt] (Cle $pp.Name) }
              if ($bt -eq 'tool_use') { Incr $st.Outils (NomOutil $b.name) }
              if ($bt -eq 'image') { $c.Images++ }
              if ($bt -eq 'tool_result' -and $b.content -is [System.Array]) {
                foreach ($sb in $b.content) { if ((EstObjet $sb) -and $sb.type -eq 'image') { $c.Images++ } }
              }
            }
          }
        }
      }
    } catch { Avert ('Lecture interrompue : ' + (NettoieMessage $_.Exception.Message)) }
    finally { if ($sr) { $sr.Dispose() } }
    $c.MessageIdsDistincts += $msgIds.Count
    foreach ($v in $msgIds.Values) { if ($v -gt $c.MaxLignesParReponse) { $c.MaxLignesParReponse = $v } }

    # Sous-agents de cette session (directs et de workflow) : clés de .meta.json, type d'agent (liste blanche), rattachement.
    $dsa = Joindre (Joindre ([System.IO.Path]::GetDirectoryName($s.Chemin)) $s.Id) 'subagents'
    if ([System.IO.Directory]::Exists((Long ($dsa)))) {
      $metas = New-Object System.Collections.Generic.List[object]
      foreach ($f in (Fichiers $dsa '*.meta.json')) { $metas.Add(@($f, 'direct')) }
      $nbWfAgents = 0; $dossiersWf = @(SousDossiers (Joindre $dsa 'workflows'))
      foreach ($dwf in $dossiersWf) {
        $nbWfAgents += @(Fichiers $dwf.FullName 'agent-*.jsonl').Count
        foreach ($f in (Fichiers $dwf.FullName '*.meta.json')) { $metas.Add(@($f, 'workflow')) }
      }
      $clesMeta = @{}; $typesAgent = @{}; $rattache = @{}
      foreach ($paire in ($metas | Select-Object -First 40)) {
        $j = LireJsonFichier $paire[0].FullName 1MB
        foreach ($pp in (Proprietes $j)) { Incr $clesMeta (Cle $pp.Name) }
        if ($null -ne $j) {
          Incr $typesAgent (Valeur $j.agentType)
          $lien = 'sans toolUseId ni workflowPhase'
          if ($j.toolUseId) { $lien = 'toolUseId' } elseif ($null -ne $j.workflowPhase) { $lien = 'workflowPhase' }
          Incr $rattache ($paire[1] + ' : ' + $lien)
        }
      }
      Ecrire ('    sous-agents : {0} direct(s), {1} de workflow dans {2} workflow(s) ; clés .meta.json : {3} ; agentType : {4}' -f @(Fichiers $dsa 'agent-*.jsonl').Count, $nbWfAgents, $dossiersWf.Count, (ListeCles $clesMeta), (ListeCles $typesAgent))
      Ecrire ('      rattachement : {0}' -f (($rattache.GetEnumerator() | Sort-Object Key | ForEach-Object { '{0} = {1}' -f $_.Key, $_.Value }) -join ' ; '))
    }
  }
  Ecrire ''
  Ecrire '  Compteurs (échantillon) :'
  foreach ($k in $c.Keys) { Ecrire ('    {0} : {1}' -f $k, $c[$k]) }
  Ecrire '  Types d''enregistrements :'; EcrireComptes $st.Types '    '
  Ecrire '  Sous-types system :'; EcrireComptes $st.SousTypes '    '
  Ecrire '  Clés de premier niveau par type :'
  foreach ($t in ($st.ClesParType.Keys | Sort-Object)) { Ecrire ('    {0} : {1}' -f $t, (ListeCles $st.ClesParType[$t])) }
  Ecrire '  Clés de message par type :'
  foreach ($t in ($st.ClesMessage.Keys | Sort-Object)) { Ecrire ('    {0} : {1}' -f $t, (ListeCles $st.ClesMessage[$t])) }
  Ecrire '  Blocs de contenu :'; EcrireComptes $st.Blocs '    '
  Ecrire '  Clés par type de bloc :'
  foreach ($t in ($st.ClesBlocs.Keys | Sort-Object)) { Ecrire ('    {0} : {1}' -f $t, (ListeCles $st.ClesBlocs[$t])) }
  Ecrire ('  Clés de toolUseResult : {0}' -f (ListeCles $st.ClesToolUseResult))
  Ecrire ('  Clés de compactMetadata : {0}' -f (ListeCles $st.ClesCompact))
  Ecrire ('  Clés de origin : {0}' -f (ListeCles $st.ClesOrigin))
  Ecrire '  origin.kind :'; EcrireComptes $st.Origines '    '
  Ecrire '  message.role :'; EcrireComptes $st.Roles '    '
  Ecrire '  stop_reason :'; EcrireComptes $st.Arrets '    '
  Ecrire '  Modèles :'; EcrireComptes $st.Modeles '    '
  Ecrire '  entrypoint (toutes lignes) :'; EcrireComptes $st.Entrypoints '    '
  Ecrire ('  Versions distinctes dans l''échantillon : {0}' -f $st.Versions.Count)
  Ecrire '  Outils appelés (noms ; serveurs MCP masqués) :'; EcrireComptes $st.Outils '    ' 60
  $script:UuidPartages = $c.UuidPartagesEntreFichiers
  $script:SecretsEchantillon = $c.SecretsSuspects
  Ecrire ('  => uuid partagés entre fichiers de l''échantillon : {0} (si > 0 après un /branch : le fork recopie les uuid)' -f $c.UuidPartagesEntreFichiers)
}

function AuditClaude {
  Titre '2. Claude Code'
  SousTitre 'Variables d''environnement'
  foreach ($nom in 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_PROJECT_DIR_NAME', 'CLAUDE_CODE_SKIP_PROMPT_HISTORY', 'CLAUDE_CODE_TRANSCRIPT_LOCAL_GC') {
    $vals = LireVariable $nom
    if ($vals.Count -eq 0) { Ecrire ('  {0} : non défini' -f $nom) }
    foreach ($v in $vals) {
      if ($nom -eq 'CLAUDE_CONFIG_DIR') {
        Ecrire ('  {0} ({1}) : {2}' -f $nom, (Portee $v.Portee), (Chemin $v.Valeur))
        AjouteRacine $script:RacinesClaude $v.Valeur ('CLAUDE_CONFIG_DIR ' + (Portee $v.Portee))
      } elseif ($nom -eq 'CLAUDE_CODE_PROJECT_DIR_NAME') {
        Ecrire ('  {0} ({1}) : défini (valeur masquée)' -f $nom, (Portee $v.Portee))
      } else {
        Ecrire ('  {0} ({1}) : {2}' -f $nom, (Portee $v.Portee), (Valeur $v.Valeur))
      }
    }
  }
  AjouteRacine $script:RacinesClaude (Joindre $Profil '.claude') 'défaut'
  foreach ($e in $script:ReglagesT3) {
    if ($e.Genre -eq 'claude' -and $e.Cle -ne 'binaryPath' -and $e.Valeur) { AjouteRacine $script:RacinesClaude $e.Valeur ('réglage T3 ' + $e.Cle) }
  }
  $global = Joindre $Profil '.claude.json'
  if ([System.IO.File]::Exists((Long ($global)))) { DecrireFichier $global '%USERPROFILE%\.claude.json (configuration globale, non ouverte)' }

  SousTitre 'Réglages gérés (managed-settings.json)'
  foreach ($base in @($env:ProgramFiles, $env:ProgramData)) {
    if ([string]::IsNullOrEmpty($base)) { continue }
    $f = Joindre (Joindre $base 'ClaudeCode') 'managed-settings.json'
    if ([System.IO.File]::Exists((Long ($f)))) { LireReglagesClaude $f ('managed-settings.json (' + ($(if ($base -eq $env:ProgramFiles) { 'Program Files' } else { 'ProgramData' })) + ')') }
  }
  Ecrire '  (absents sauf mention ci-dessus)'

  foreach ($r in $script:RacinesClaude) { AuditRacineClaude $r }
  SyntheseClaude
  AnalyseEchantillon
}

# ---------------------------------------------------------------------------
# 4. T3 Code
# ---------------------------------------------------------------------------
function VersUri([string]$chemin, [string]$parametre) {
  # URI SQLite entièrement en ASCII (encodage %XX), pour éviter tout souci d'accents en ligne de commande.
  $p = $chemin -replace '\\', '/'
  $sb = New-Object System.Text.StringBuilder
  foreach ($b in [System.Text.Encoding]::UTF8.GetBytes($p)) {
    $ok = ($b -ge 0x30 -and $b -le 0x39) -or ($b -ge 0x41 -and $b -le 0x5A) -or ($b -ge 0x61 -and $b -le 0x7A) -or ($b -lt 128 -and '/-._~:'.IndexOf([char]$b) -ge 0)
    if ($ok) { [void]$sb.Append([char]$b) } else { [void]$sb.Append('%' + $b.ToString('X2')) }
  }
  $prefixe = 'file:///'
  if ($p.StartsWith('/')) { $prefixe = 'file://' }
  return ($prefixe + $sb.ToString() + '?' + $parametre)
}
function EtatFichier([string]$p, [bool]$sha = $false) {
  # Présence, taille, date et, sur demande, début du SHA-256 (lecture avec partage complet).
  $fi = [System.IO.FileInfo]::new((Long $p))
  if (-not $fi.Exists) { return 'absent' }
  $t = '{0}:{1}' -f $fi.Length, $fi.LastWriteTimeUtc.Ticks
  if ($sha -and $fi.Length -le 1GB) {
    try {
      $fs = Ouvrir $p
      try {
        $h = [System.Security.Cryptography.SHA256]::Create()
        try { $t += ':' + [BitConverter]::ToString($h.ComputeHash($fs)).Replace('-', '').Substring(0, 16) } finally { $h.Dispose() }
      } finally { $fs.Dispose() }
    } catch { $t += ':sha-illisible' }
  }
  return $t
}
function EmpreinteBase([string]$db) {
  # -shm : jamais ouvert (verrous de plage de SQLite sous Windows) ; présence, taille et date seulement.
  return ('base=' + (EtatFichier $db $true) + ' | wal=' + (EtatFichier ($db + '-wal') $true) + ' | shm=' + (EtatFichier ($db + '-shm') $false))
}
function Id([string]$n) { return ('[' + $n.Replace(']', ']]') + ']') }
function NomTable([string]$t) {
  if ($script:TablesAmont -contains $t) { return $t }
  return ('table-fork:' + (Hache $t))
}

# Lecteur node:sqlite (le moteur de Rémy) : une requête par ligne sur l'entrée standard, première colonne
# de chaque ligne de résultat sur la sortie, erreurs « E|n|message » sur la sortie d'erreur. Ouverture readOnly.
$script:JsLecteur = (@'
const { DatabaseSync } = require('node:sqlite');
let db;
try { db = new DatabaseSync(process.argv[1], { readOnly: true }); }
catch (e) { process.stderr.write('E|ouverture|' + String(e && e.message).slice(0, 160) + '\n'); process.exit(3); }
const lignes = require('fs').readFileSync(0, 'utf8').split('\n');
let n = 0;
for (const l of lignes) {
  const q = l.trim();
  if (!q || q.startsWith('.')) continue;
  n++;
  try { for (const r of db.prepare(q).all()) { const v = Object.values(r)[0]; process.stdout.write((v === null ? '' : String(v)) + '\n'); } }
  catch (e) { process.stderr.write('E|' + n + '|' + String(e && e.message).slice(0, 160) + '\n'); }
}
db.close();
'@ -replace "`r?`n", ' ')
# Format de sortie imposé à sqlite3 (en plus de -init, qui écarte ~\.sqliterc).
$script:EnteteSql = ".bail off`n.headers off`n.mode list`n.separator |`n"

function PrepareMoteur {
  $script:MoteurSql = $null; $script:NodeDrapeaux = @(); $script:Sqlite3Drapeaux = @()
  if ($Moteur -ne 'sqlite3') {
    $node = TrouveProgramme @('node.exe', 'node')
    if ($node) {
      $r = Lance $node @('--version') $null 15000
      $m = [regex]::Match([string]$r.Sortie.Trim(), '^v(\d+)\.(\d+)')
      if ($m.Success) {
        $maj = [int]$m.Groups[1].Value; $min = [int]$m.Groups[2].Value
        if (($maj -eq 22 -and $min -ge 5 -and $min -lt 13) -or ($maj -eq 23 -and $min -lt 4)) { $script:NodeDrapeaux = @('--experimental-sqlite') }
        if (($maj -eq 22 -and $min -ge 5) -or $maj -ge 23) {
          $t = Lance $node (@('--no-warnings') + $script:NodeDrapeaux + @('-e', "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync(':memory:').prepare('select sqlite_version() v').get().v)")) $null 20000
          if ($t.Code -eq 0 -and $t.Sortie.Trim() -match '^\d+\.\d+') { $script:MoteurSql = 'node'; $script:Node = $node; Ecrire ('  moteur SQL : node:sqlite (celui de Rémy), SQLite {0}' -f $t.Sortie.Trim()) }
        }
      }
    }
    if (-not $script:MoteurSql) { Ecrire '  node:sqlite : indisponible (Node absent ou antérieur à 22.5)' }
  }
  if (-not $script:MoteurSql -and $Moteur -ne 'node') {
    $exe = $null
    if ($Sqlite3) { if ([System.IO.File]::Exists((Long ($Sqlite3)))) { $exe = $Sqlite3 } else { Avert '-Sqlite3 : fichier introuvable' } }
    else { $exe = TrouveProgramme @('sqlite3.exe', 'sqlite3') }
    if ($exe) {
      $rv = Lance $exe @('-version') $null 15000
      $ver = [string](($rv.Sortie -split ' ')[0])
      $script:Sqlite3Drapeaux = @('-init', $(if ($script:EstWindows) { 'NUL' } else { '/dev/null' }))
      if ($ver -match '^3\.(\d+)' -and [int]$Matches[1] -ge 37) { $script:Sqlite3Drapeaux += '-safe' } else { Avert 'sqlite3 antérieur à 3.37 : lancé sans -safe' }
      $script:MoteurSql = 'sqlite3'; $script:Sqlite3Exe = $exe
      Ecrire ('  moteur SQL : sqlite3 {0} (avec {1})' -f (Valeur $ver), ($script:Sqlite3Drapeaux -join ' '))
    }
  }
  if (-not $script:MoteurSql) { Avert 'ni node:sqlite ni sqlite3 : tables T3 non listées, PAS de recoupement T3 <-> JSONL (installer Node 22.13+ ou passer -Sqlite3)' }
}
function ExecSql([string]$uri, [string]$sql, [int]$delaiMs = 60000) {
  if ($script:MoteurSql -eq 'node') {
    return (Lance $script:Node (@('--no-warnings') + $script:NodeDrapeaux + @('-e', $script:JsLecteur, $uri)) $sql $delaiMs)
  }
  return (Lance $script:Sqlite3Exe (@('-readonly', '-batch', '-noheader') + $script:Sqlite3Drapeaux + @($uri)) ($script:EnteteSql + $sql) $delaiMs)
}
function LignesSql($r) {
  if ($null -eq $r -or -not $r.Sortie) { return @() }
  return @(($r.Sortie -split "`n") | ForEach-Object { $_.TrimEnd("`r") } | Where-Object { $_ })
}
function ErreursSql($r) {
  if ($null -eq $r -or -not $r.Erreur) { return @() }
  return @(($r.Erreur -split "`n") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

# Copie de la base (option -CopieT3) : lecture avec partage complet, rien n'est ouvert par SQLite chez T3.
function CopieFichier([string]$src, [string]$dst) {
  $in = Ouvrir $src
  try {
    $out = [System.IO.FileStream]::new($dst, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try { $in.CopyTo($out, 1048576) } finally { $out.Dispose() }
  } finally { $in.Dispose() }
}
function SupprimeFichiersCopie($c) {
  foreach ($suf in '', '-wal', '-shm', '-journal') { $f = $c.Base + $suf; if ([System.IO.File]::Exists($f)) { [System.IO.File]::Delete($f) } }
}
function SupprimeCopie($c, [string]$libelle = 'copie supprimée') {
  try {
    SupprimeFichiersCopie $c
    if ([System.IO.Directory]::Exists($c.Dossier)) { [System.IO.Directory]::Delete($c.Dossier, $false) }
    Ecrire ('    {0} (effacement simple : le contenu peut rester lisible sur le disque, d''où BitLocker)' -f $libelle)
  } catch { Avert ('copie NON supprimée, à effacer à la main : %USERPROFILE%\.remy\prive\' + [System.IO.Path]::GetFileName($c.Dossier)) }
}
function PurgeCopiesAnciennes {
  # Copies laissées par un passage interrompu : uniquement les dossiers tmp-audit-* et leurs fichiers copie.sqlite*.
  $d = Joindre (Joindre $Profil '.remy') 'prive'
  if (-not [System.IO.Directory]::Exists($d)) { return }
  try {
    foreach ($x in [System.IO.DirectoryInfo]::new($d).GetDirectories('tmp-audit-*')) {
      SupprimeCopie ([pscustomobject]@{ Dossier = $x.FullName; Base = (Joindre $x.FullName 'copie.sqlite') }) 'ancienne copie d''un passage interrompu supprimée'
    }
  } catch {}
}
function CopieBase([string]$db) {
  $dossier = Joindre (Joindre (Joindre $Profil '.remy') 'prive') ('tmp-audit-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
  $c = [pscustomobject]@{ Dossier = $dossier; Base = (Joindre $dossier 'copie.sqlite'); AvecWal = $false }
  $wal = $db + '-wal'
  $debut = Get-Date
  try { [void][System.IO.Directory]::CreateDirectory($dossier) } catch { Avert ('copie impossible : ' + (NettoieMessage $_.Exception.Message)); return $null }
  for ($essai = 1; $essai -le 3; $essai++) {
    SupprimeFichiersCopie $c
    $avant = (EtatFichier $db) + '|' + (EtatFichier $wal)
    try {
      CopieFichier $db $c.Base
      $c.AvecWal = [System.IO.File]::Exists((Long $wal))
      if ($c.AvecWal) { CopieFichier $wal ($c.Base + '-wal') }
    } catch {
      $script:CopieRefusee = $true
      Avert ('copie refusée (essai {0}) : {1}' -f $essai, (NettoieMessage $_.Exception.Message))
      continue
    }
    $apres = (EtatFichier $db) + '|' + (EtatFichier $wal)
    if ($avant -eq $apres) {
      $script:CopieFaite = $true
      Ecrire ('    copie stable au {0}e essai en {1:N1} s (base{2}) ; taille {3}' -f $essai, ((Get-Date) - $debut).TotalSeconds, $(if ($c.AvecWal) { ' + -wal' } else { '' }), (Taille ([System.IO.FileInfo]::new($c.Base).Length)))
      return $c
    }
    Ecrire ('    copie : T3 a écrit pendant l''essai {0}, on recommence' -f $essai)
  }
  Avert 'copie instable après 3 essais (T3 écrit sans arrêt) : base non lue'
  SupprimeCopie $c
  return $null
}

function AnalyseBaseSqlite([string]$db) {
  $script:CopieIncoherente = $false
  $res = @{ Tables = @{}; Migrations = New-Object System.Collections.Generic.List[object]; Natifs = New-Object System.Collections.Generic.List[object]; Lue = $false }
  if ($db.StartsWith('\\')) { Ecrire '    base sur un partage (WSL/réseau) : non lue'; return $res }
  if (-not $script:MoteurSql) { Ecrire '    aucun moteur SQL : tables non listées, pas de recoupement T3 <-> JSONL'; return $res }
  $wal = $db + '-wal'; $shm = $db + '-shm'
  $walExiste = [System.IO.File]::Exists((Long ($wal))); $shmExiste = [System.IO.File]::Exists((Long ($shm)))
  $avant = EmpreinteBase $db
  $copie = $null; $uri = $null
  if ($shmExiste -and $walExiste) {
    # -wal ET -shm présents, même -wal vide : une connexion est ouverte (T3 lancé). Jamais d'ouverture directe.
    $script:T3Ouvert = $true
    if (-not $CopieT3) { Ecrire '    T3 semble ouvert (-wal et -shm présents) : base NON lue. Ferme T3 et relance, ou relance avec -CopieT3.'; return $res }
    $copie = CopieBase $db
    if (-not $copie) { return $res }
  } elseif ($shmExiste -or $walExiste) {
    if ($CopieT3) { $copie = CopieBase $db; if (-not $copie) { return $res } }
    else { Avert '-wal ou -shm résiduel sans l''autre (arrêt brutal de T3 ?) : lecture immutable=1, WAL ignoré, chiffres possiblement incomplets (-CopieT3 pour une lecture complète)' }
  }
  if ($copie) {
    $uri = VersUri $copie.Base $(if ($copie.AvecWal) { 'mode=ro' } else { 'immutable=1' })
    Ecrire ('    lecture : copie temporaire ({0}) ; SQLite n''ouvre aucun fichier de T3' -f $(if ($copie.AvecWal) { 'mode=ro, WAL de la copie appliqué' } else { 'immutable=1' }))
  } else {
    if ($script:ProcT3) { Avert 'un processus T3 tourne alors que la base n''a ni -wal ni -shm : lecture immutable=1 contrôlée avant/après' }
    $uri = VersUri $db 'immutable=1'
    if (-not ($shmExiste -or $walExiste)) { Ecrire '    lecture : immutable=1 sur la base (T3 fermé : ni -wal ni -shm ; aucun fichier créé ni modifié)' }
  }
  $debut = Get-Date
  try {
    # 1. Schéma (et cohérence de la copie).
    $sql1 = "SELECT 'V|' || sqlite_version();`n" +
    "SELECT 'T|' || type || '|' || name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name;`n" +
    "SELECT 'C|' || m.name || '|' || p.name || '|' || p.type FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, p.cid;`n"
    if ($copie) { $sql1 += "SELECT 'Q|' || quick_check FROM pragma_quick_check LIMIT 3;`n" }
    $r1 = ExecSql $uri $sql1 120000
    if ($r1.Code -eq -1) { Avert 'délai dépassé : lecture du schéma'; return $res }
    $l1 = LignesSql $r1
    if ($l1.Count -eq 0) { Avert ('lecture du schéma impossible : ' + (NettoieMessage (((ErreursSql $r1) | Select-Object -First 1) -replace [regex]::Escape($db), '(base)'))); return $res }
    $tables = [ordered]@{}
    foreach ($l in $l1) {
      $p = $l.Split('|')
      if ($p[0] -eq 'V') { Ecrire ('    version de SQLite : {0}' -f (Valeur $p[1])) }
      elseif ($p[0] -eq 'T' -and $p.Count -ge 3) { $tables[$p[2]] = New-Object System.Collections.Generic.List[string] }
      elseif ($p[0] -eq 'C' -and $p.Count -ge 4) { if ($tables.Contains($p[1])) { $tables[$p[1]].Add(((Cle $p[2]) + ' ' + (Valeur $p[3])).Trim()) } }
      elseif ($p[0] -eq 'Q') { if ($p[1] -ne 'ok') { $script:CopieIncoherente = $true } }
    }
    if ($script:CopieIncoherente) { Avert 'quick_check de la copie : erreurs (copie incohérente) ; chiffres non fiables' }
    elseif ($copie) { Ecrire '    quick_check de la copie : ok' }
    $res.Lue = $true

    # 2. Requêtes rapides et décisives, à part : migrations, projets, identifiants natifs.
    $sb = New-Object System.Text.StringBuilder
    foreach ($t in $tables.Keys) {
      $cols = @($tables[$t] | ForEach-Object { ($_ -split ' ')[0] })
      if ($t -eq 'effect_sql_migrations' -and ($cols -contains 'migration_id') -and ($cols -contains 'name')) { [void]$sb.AppendLine("SELECT 'M|' || migration_id || '|' || name FROM effect_sql_migrations ORDER BY migration_id;") }
      if ($t -eq 'projection_projects' -and ($cols -contains 'workspace_root')) { [void]$sb.AppendLine("SELECT 'W|' || COUNT(*) || '|' || COUNT(DISTINCT workspace_root) FROM projection_projects;") }
      if ($t -match 'provider_threads$' -and ($cols -contains 'payload_json') -and (($cols -contains 'driver') -or ($cols -contains 'provider'))) {
        # La colonne provider contient l'identifiant d'INSTANCE ; le pilote est dans driver (Foundation.ts amont).
        $pil = 'provider'; if ($cols -contains 'driver') { $pil = $(if ($cols -contains 'provider') { 'COALESCE(driver, provider)' } else { 'driver' }) }
        [void]$sb.AppendLine("SELECT 'P|' || COALESCE($pil,'?') || '|' || COALESCE(json_extract(payload_json,'$.nativeThreadRef.nativeId'),'') FROM $(Id $t);")
      }
    }
    if ($sb.Length -gt 0) {
      $r2 = ExecSql $uri $sb.ToString() 120000
      if ($r2.Code -eq -1) { Avert 'délai dépassé : migrations, projets et identifiants natifs' }
      foreach ($l in (LignesSql $r2)) {
        $p = $l.Split('|')
        switch ($p[0]) {
          'M' { if ($p.Count -ge 3) { $res.Migrations.Add([pscustomobject]@{ Id = $p[1]; Nom = $p[2] }) } }
          'P' { if ($p.Count -ge 3) { $res.Natifs.Add([pscustomobject]@{ Fournisseur = $p[1]; Natif = $p[-1].ToLowerInvariant() }) } }
          'W' { if ($p.Count -ge 3) { Ecrire ('    projets T3 : {0} ligne(s), {1} workspace_root distinct(s)' -f $p[1], $p[2]) } }
        }
      }
      $e2 = ErreursSql $r2
      if ($e2.Count) { Ecrire ('    {0} requête(s) décisive(s) refusée(s) : {1}' -f $e2.Count, (NettoieMessage ($e2[0] -replace [regex]::Escape($db), '(base)'))) }
    }

    # 3. Comptages table par table, chacun avec son délai (aucun texte de message lu).
    $enumCols = @('role', 'event_type', 'provider', 'driver', 'type', 'status', 'kind', 'history_origin', 'origin', 'source')
    $dateCols = @('created_at', 'updated_at', 'occurred_at', 'archived_at', 'deleted_at')
    $comptes = @{}; $groupes = @{}; $dates = New-Object System.Collections.Generic.List[string]; $nbDelais = 0
    foreach ($t in $tables.Keys) {
      if (((Get-Date) - $debut).TotalSeconds -gt 600 -or $nbDelais -ge 3) { Avert ('comptages arrêtés (budget de 10 min ou 3 délais dépassés) avant la table ' + (NomTable $t)); break }
      $tid = Id $t; $cols = @($tables[$t] | ForEach-Object { ($_ -split ' ')[0] })
      $q = New-Object System.Text.StringBuilder
      [void]$q.AppendLine("SELECT 'N|' || COUNT(*) FROM $tid;")
      foreach ($col in $cols) {
        if ($enumCols -contains $col) { [void]$q.AppendLine("SELECT 'G|$col|' || COALESCE(CAST($(Id $col) AS TEXT),'(null)') || '|' || COUNT(*) FROM $tid GROUP BY $(Id $col) ORDER BY COUNT(*) DESC LIMIT 25;") }
        if (($dateCols -contains $col) -and ($t -match 'thread|message|event|project|turn')) { [void]$q.AppendLine("SELECT 'D|$col|' || COALESCE(MIN($(Id $col)),'') || '|' || COALESCE(MAX($(Id $col)),'') || '|' || COUNT($(Id $col)) FROM $tid;") }
      }
      $rt = ExecSql $uri $q.ToString() 60000
      if ($rt.Code -eq -1) { $nbDelais++; Avert ('délai dépassé (60 s) : table ' + (NomTable $t)); continue }
      foreach ($l in (LignesSql $rt)) {
        $p = $l.Split('|')
        switch ($p[0]) {
          'N' { if ($p.Count -ge 2) { $comptes[$t] = $p[1] } }
          'G' {
            # Valeur libre éventuellement porteuse de « | » : le compte est le dernier champ, entier.
            if ($p.Count -ge 4 -and $p[-1] -match '^\d+$') {
              $val = ($p[2..($p.Count - 2)] -join '|'); $k = (NomTable $t) + '.' + (Cle $p[1])
              if (-not $groupes.ContainsKey($k)) { $groupes[$k] = New-Object System.Collections.Generic.List[string] }
              $groupes[$k].Add(('{0}={1}' -f (Valeur $val), $p[-1]))
            }
          }
          'D' {
            if ($p.Count -ge 5) {
              $bornes = foreach ($b in @($p[2], $p[3])) {
                if ($b -match '^\d{4}-\d{2}-\d{2}') { $b.Substring(0, 10) } elseif ($b -match '^\d+(\.\d+)?$') { DateCourte (VersDate ([double]$b)) } else { '?' }
              }
              $dates.Add(('{0}.{1} : {2} -> {3} ({4} valeurs)' -f (NomTable $t), (Cle $p[1]), $bornes[0], $bornes[1], $p[4]))
            }
          }
        }
      }
      $et = ErreursSql $rt
      if ($et.Count) { Ecrire ('    table {0} : {1} requête(s) refusée(s) : {2}' -f (NomTable $t), $et.Count, (NettoieMessage ($et[0] -replace [regex]::Escape($db), '(base)'))) }
    }
    Ecrire ('    tables : {0} (dont propres au fork : {1})' -f $tables.Count, @($tables.Keys | Where-Object { $script:TablesAmont -notcontains $_ }).Count)
    foreach ($t in $tables.Keys) {
      $n = '?'; if ($comptes.ContainsKey($t)) { $n = $comptes[$t] }
      if ($script:TablesAmont -contains $t) { Ecrire ('      {0} ({1} lignes) : {2}' -f $t, $n, ($tables[$t] -join ', ')) }
      else { Ecrire ('      {0} ({1} lignes) : {2} colonne(s), noms non affichés' -f (NomTable $t), $n, $tables[$t].Count) }
      $res.Tables[$t] = $n
    }
    if ($groupes.Count -gt 0) {
      Ecrire '    répartitions (valeurs de la liste blanche ; autres hachées) :'
      foreach ($k in ($groupes.Keys | Sort-Object)) { Ecrire ('      {0} : {1}' -f $k, ($groupes[$k] -join ', ')) }
    }
    if ($dates.Count -gt 0) { Ecrire '    plages de dates (au jour) :'; foreach ($d in $dates) { Ecrire ('      ' + $d) } }
    Ecrire ('    durée de lecture : {0:N1} s' -f ((Get-Date) - $debut).TotalSeconds)
  } finally {
    if ($copie) { SupprimeCopie $copie }
  }
  $apres = EmpreinteBase $db
  if ($avant -eq $apres) { Ecrire '    contrôle : base et -wal de T3 identiques avant/après (taille, date, SHA-256) ; -shm : même présence, taille et date' }
  elseif ($copie) { Avert 'fichiers de T3 changés pendant l''audit : écritures de T3 lui-même (la copie lue avait été vérifiée stable)' }
  else {
    Avert 'fichiers de T3 changés pendant une lecture immutable=1 (T3 a démarré ?) : résultats NON FIABLES, relance T3 fermé'
    $res.Natifs.Clear(); $res.Lue = $false
  }
  return $res
}

function CompareMigrations($migs, [bool]$base = $true) {
  if ($migs.Count -eq 0) { Ecrire '    migrations : table effect_sql_migrations absente ou illisible'; return }
  $max = 0; $conformes = 0; $preversion = 0; $bloquantes = 0
  $diff = New-Object System.Collections.Generic.List[string]; $au_dela = New-Object System.Collections.Generic.List[string]
  foreach ($m in $migs) {
    $i = 0; [void][int]::TryParse($m.Id, [ref]$i)
    if ($i -gt $max) { $max = $i }
    # Nom amont en clair ; nom propre au fork haché (il peut nommer un client ou un projet).
    $aff = $m.Nom; if ($script:MigrationsAmont -notcontains $m.Nom) { $aff = 'fork:' + (Hache $m.Nom) }
    if (($i -eq 53 -or $i -eq 54) -and $m.Nom -eq 'OrchestrationV2') { $preversion++; continue }
    if ($i -ge 1 -and $i -le $script:MigrationsAmont.Count) {
      if ($script:MigrationsAmont[$i - 1] -eq $m.Nom) { $conformes++ }
      else {
        if ($i -ge $script:PremiereMigrationV2) { $bloquantes++; $diff.Add(('{0}:{1} [>= 55 : BadState]' -f $i, $aff)) }
        else { $diff.Add(('{0}:{1} [< 55 : sautée avec avertissement]' -f $i, $aff)) }
      }
    } else { $au_dela.Add(('{0}:{1}' -f $i, $aff)) }
  }
  if ($base -and $max -gt $script:T3MigrationMax) { $script:T3MigrationMax = $max }
  Ecrire ('    migrations enregistrées : {0} (plus haut identifiant {1} ; amont au 19/10/2026 : {2})' -f $migs.Count, $max, $script:MigrationsAmont.Count)
  Ecrire ('      identiques à l''amont : {0} ; préversion V2 amont (OrchestrationV2 en 53/54, renumérotée par T3) : {1} ; nom différent : {2} ; au-delà de l''amont : {3}' -f $conformes, $preversion, $diff.Count, $au_dela.Count)
  if ($diff.Count) { Ecrire ('      différentes : ' + ($diff -join ', ')) }
  if ($au_dela.Count) { Ecrire ('      au-delà : ' + ($au_dela -join ', ')) }
  if ($bloquantes) { Avert ('{0} migration(s) V2 (identifiant >= 55) sous un autre nom : T3 amont refuserait de démarrer sur cette base (MigrationError BadState)' -f $bloquantes) }
  if ($base -and ($diff.Count + $au_dela.Count) -gt $script:T3MigrationsFork) { $script:T3MigrationsFork = $diff.Count + $au_dela.Count }
}

function AuditT3 {
  Titre '3. T3 Code'
  SousTitre 'Variables et racines'
  $v = LireVariable 'T3CODE_HOME'
  if ($v.Count -eq 0) { Ecrire '  T3CODE_HOME : non défini' }
  foreach ($x in $v) { Ecrire ('  T3CODE_HOME ({0}) : {1}' -f (Portee $x.Portee), (Chemin $x.Valeur)) }
  if ($DepotFork) { Ecrire ('  worktrees liés du fork (git worktree list) : {0}' -f $script:WorktreesFork.Count) }
  PrepareMoteur

  foreach ($r in (RacinesT3)) {
    SousTitre ('Racine T3 : {0} (origine : {1})' -f (Chemin $r.Chemin), $r.Origine)
    if (-not [System.IO.Directory]::Exists((Long ($r.Chemin)))) { Ecrire '  absente'; continue }
    $script:T3Trouve = $true
    foreach ($sd in (SousDossiers $r.Chemin)) {
      $nomAff = NomStandard $sd.Name $script:NomsT3
      $m = MesureDossier $sd.FullName 100000 6
      Ecrire ('  [dossier] {0} : {1} fichiers, {2}, dernier changement {3}{4}' -f $nomAff, $m.Fichiers, (Taille $m.Octets), (DateCourte $m.Recent), ($(if ($m.Secrets) { ' (sous-dossier secrets\ non parcouru)' } else { '' })))
    }
    $wt = Joindre $r.Chemin 'worktrees'
    if ([System.IO.Directory]::Exists((Long ($wt)))) {
      $n1 = @(SousDossiers $wt).Count; $n2 = 0; foreach ($d in (SousDossiers $wt)) { $n2 += @(SousDossiers $d.FullName).Count }
      Ecrire ('  worktrees : {0} dossier(s) de 1er niveau, {1} de 2e niveau' -f $n1, $n2)
    }
    foreach ($sous in 'userdata', 'dev') {
      $d = Joindre $r.Chemin $sous
      if (-not [System.IO.Directory]::Exists((Long ($d)))) { Ecrire ('  {0}\ : absent' -f $sous); continue }
      Ecrire ('  {0}\ :' -f $sous)
      foreach ($f in 'statev2.sqlite', 'statev2.sqlite-wal', 'statev2.sqlite-shm', 'state.sqlite', 'state.sqlite-wal', 'state.sqlite-shm', 'settings.json') {
        DecrireFichier (Joindre $d $f) ('  ' + $f)
      }
      $autresBases = @(Fichiers $d '*.sqlite' | Where-Object { $_.Name -notin @('statev2.sqlite', 'state.sqlite') })
      foreach ($ab in $autresBases) { Ecrire ('    autre base : {0} ({1})' -f (Valeur $ab.Name), (Taille $ab.Length)) }
      if ([System.IO.Directory]::Exists((Long ((Joindre $d 'secrets'))))) { Ecrire '    secrets\ : présent (jamais ouvert)' }
      $da = Joindre $d 'attachments'
      if ([System.IO.Directory]::Exists((Long ($da)))) { $m = MesureDossier $da 100000 6; Ecrire ('    attachments\ : {0} fichiers, {1}' -f $m.Fichiers, (Taille $m.Octets)) }
      $ev = Joindre (Joindre (Joindre $d 'logs') 'provider') 'events.log'
      if ([System.IO.File]::Exists((Long ($ev)))) { DecrireFichier $ev '  logs\provider\events.log (jamais ouvert)' }
      $dl = Joindre $d 'logs'
      if ([System.IO.Directory]::Exists((Long ($dl)))) {
        $m = MesureDossier $dl 100000 6; Ecrire ('    logs\ : {0} fichiers, {1} (jamais ouverts)' -f $m.Fichiers, (Taille $m.Octets))
        $dt = Joindre $dl 'terminals'; if ([System.IO.Directory]::Exists((Long $dt))) { $m = MesureDossier $dt 100000 4; Ecrire ('    logs\terminals\ : {0} fichiers, {1} (sorties de terminal : jamais ouvertes)' -f $m.Fichiers, (Taille $m.Octets)) }
        $tr = Joindre $dl 'server.trace.ndjson'; if ([System.IO.File]::Exists((Long $tr))) { DecrireFichier $tr '  logs\server.trace.ndjson (jamais ouvert)' }
      }
      $dba = Joindre $d 'browser-artifacts'
      if ([System.IO.Directory]::Exists((Long ($dba)))) { $m = MesureDossier $dba 100000 6; Ecrire ('    browser-artifacts\ : {0} fichiers, {1} (jamais ouverts)' -f $m.Fichiers, (Taille $m.Octets)) }
      $dc = Joindre (Joindre $d 'providers') 'codex'
      if ([System.IO.Directory]::Exists((Long ($dc)))) {
        $inst = @(SousDossiers $dc)
        $avecShadow = @($inst | Where-Object { [System.IO.Directory]::Exists((Long ((Joindre $_.FullName 'shadow')))) }).Count
        Ecrire ('    providers\codex : {0} instance(s), {1} avec shadow home' -f $inst.Count, $avecShadow)
      }
      foreach ($e in ($script:ReglagesT3 | Where-Object { $_.Sous -eq $sous -and $_.Fichier.StartsWith($d, [System.StringComparison]::OrdinalIgnoreCase) })) {
        if ($e.Cle) {
          $existe = 'n/a'; if ($e.Valeur) { $existe = ([System.IO.Directory]::Exists((Long ($e.Valeur))) -or [System.IO.File]::Exists((Long ($e.Valeur)))) }
          Ecrire ('    settings.json : {0} défini (genre {1}, {2}, existe : {3})' -f $e.Cle, $e.Genre, (Chemin $e.Valeur), $existe)
        }
        if ($e.ClesWsl) { Ecrire ('    settings.json : clés liées à WSL/backend : {0}' -f $e.ClesWsl) }
      }
      foreach ($base in 'statev2.sqlite', 'state.sqlite') {
        $chemin = Joindre $d $base
        if (-not [System.IO.File]::Exists((Long ($chemin)))) { continue }
        Ecrire ('    analyse de {0} :' -f $base)
        $res = AnalyseBaseSqlite $chemin
        if ($res.Lue) {
          CompareMigrations $res.Migrations
          foreach ($n in $res.Natifs) { $script:NatifsT3.Add($n) }
          if ($base -eq 'statev2.sqlite') { $script:T3BaseV2 = $true }
        }
      }
    }
  }

  SousTitre 'Profils Electron (%APPDATA%) et installation'
  $trouveApp = $false
  if ($env:APPDATA) {
    foreach ($n in 't3code-v2', 'T3 Code (Alpha)', 't3code', 't3code-dev', 'T3 Code (Dev)') {
      $d = Joindre $env:APPDATA $n
      if ([System.IO.Directory]::Exists((Long ($d)))) { $trouveApp = $true; $m = MesureDossier $d 50000 8; Ecrire ('  %APPDATA%\{0} : {1} fichiers, {2} (profil Electron : brouillons et prompts en localStorage ; jamais ouvert)' -f $n, $m.Fichiers, (Taille $m.Octets)) }
    }
  }
  # Installation : présence et version seulement (aucun autre logiciel nommé).
  $nbInstall = 0
  foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles)) {
    if ([string]::IsNullOrEmpty($base)) { continue }
    $dp = $base; if ($base -eq $env:LOCALAPPDATA) { $dp = Joindre $base 'Programs' }
    foreach ($d in (SousDossiers $dp | Where-Object { $_.Name -match '(?i)^t3[ ._-]?code' })) {
      foreach ($exeT3 in (Fichiers $d.FullName '*.exe' | Where-Object { $_.Name -match '(?i)^t3[ ._-]?code' } | Select-Object -First 1)) {
        $trouveApp = $true; $nbInstall++
        $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($exeT3.FullName)
        Ecrire ('  installation de T3 Code n°{0} : version {1}' -f $nbInstall, (Valeur $vi.ProductVersion))
      }
    }
  }

  if (-not $trouveApp) { Ecrire '  aucun profil Electron ni installation de T3 Code trouvés' }

  if ($DepotFork) {
    SousTitre 'Clone local du fork (-DepotFork)'
    if (-not [System.IO.Directory]::Exists((Long ($DepotFork)))) { Avert '-DepotFork : dossier introuvable' }
    else {
      $git = TrouveProgramme @('git.exe', 'git')
      if ($git) {
        # Commit haché et date au mois : un commit public et sa date suffiraient à retrouver le dépôt.
        $h = Lance $git @('-C', $DepotFork, 'rev-parse', 'HEAD') $null 20000
        $dt = Lance $git @('-C', $DepotFork, 'log', '-1', '--format=%cs') $null 20000
        $anc = Lance $git @('-C', $DepotFork, 'merge-base', '--is-ancestor', '2532e64', 'HEAD') $null 20000
        $commit = $h.Sortie.Trim(); if ($commit -match '^[0-9a-f]{40}$') { $commit = Hache $commit } else { $commit = '(git a échoué)' }
        $mois = $dt.Sortie.Trim(); if ($mois -match '^\d{4}-\d{2}-\d{2}$') { $mois = $mois.Substring(0, 7) } else { $mois = '(inconnu)' }
        $txtAnc = '(inconnu : commit amont absent du clone)'
        if ($anc.Code -eq 0) { $txtAnc = 'oui' } elseif ($anc.Code -eq 1) { $txtAnc = 'non (fork en retard ou divergent)' }
        Ecrire ('  commit : {0} (haché), mois du dernier commit : {1}, contient l''amont 2532e64 du 19/10/2026 : {2}' -f $commit, $mois, $txtAnc)
      } else { Ecrire '  git introuvable : commit non relevé' }
      $fm = [System.IO.Path]::Combine($DepotFork, 'apps', 'server', 'src', 'persistence', 'Migrations.ts')
      if ([System.IO.File]::Exists((Long ($fm)))) {
        $sr = LecteurTexte $fm; try { $txt = $sr.ReadToEnd() } finally { $sr.Dispose() }
        $migs = New-Object System.Collections.Generic.List[object]
        foreach ($m in [regex]::Matches($txt, '\[\s*(\d+)\s*,\s*"([A-Za-z0-9_]+)"')) { $migs.Add([pscustomobject]@{ Id = $m.Groups[1].Value; Nom = $m.Groups[2].Value }) }
        Ecrire '  migrations déclarées dans le code du fork :'
        CompareMigrations $migs $false
      } else { Ecrire '  Migrations.ts introuvable à l''emplacement amont (structure différente ?)' }
      $pkg = LireJsonFichier ([System.IO.Path]::Combine($DepotFork, 'apps', 'desktop', 'package.json'))
      if ($null -ne $pkg) { Ecrire ('  apps\desktop\package.json : version {0}' -f (Valeur $pkg.version)) }
      $nPersist = 0; $nFichiers = 0
      foreach ($dossier in @([System.IO.Path]::Combine($DepotFork, 'apps', 'server', 'src'))) {
        if (-not [System.IO.Directory]::Exists((Long ($dossier)))) { continue }
        try {
          foreach ($f in [System.IO.Directory]::EnumerateFiles($dossier, '*.ts', [System.IO.SearchOption]::AllDirectories)) {
            $nFichiers++
            if ($nFichiers -gt 20000) { break }
            $sr = LecteurTexte $f; try { $t = $sr.ReadToEnd() } finally { $sr.Dispose() }
            $nPersist += ([regex]::Matches($t, 'persistSession')).Count
          }
        } catch {}
      }
      Ecrire ('  occurrences de « persistSession » dans apps\server\src : {0} ({1} fichiers .ts parcourus)' -f $nPersist, $nFichiers)
    }
  }
}

# ---------------------------------------------------------------------------
# 5. Codex
# ---------------------------------------------------------------------------
function IdCodex($f) {
  # Identifiant de reprise : session_meta.payload.id (ou session_id) de la 1re ligne, comme T3 amont
  # (AgentSessionScanner.ts) ; l'UUID du nom de fichier n'est qu'un secours.
  $sr = $null
  try {
    $sr = LecteurTexte $f.FullName
    $l = $sr.ReadLine()
    if ($l) {
      if ($l.Length -le $script:MaxOctetsLigne) {
        try {
          $o = ConvertFrom-Json -InputObject $l -ErrorAction Stop
          if ($o.type -eq 'session_meta' -and (EstObjet $o.payload)) {
            $id = [string]$o.payload.id; if (-not $id) { $id = [string]$o.payload.session_id }
            if ($id) { return @($id.Trim().ToLowerInvariant(), 'session_meta') }
          }
        } catch {}
      } else {
        $m = [regex]::Match($l.Substring(0, 4096), '"(id|session_id)"\s*:\s*"([0-9a-fA-F\-]{36})"')
        if ($m.Success) { return @($m.Groups[2].Value.ToLowerInvariant(), 'session_meta') }
      }
    }
  } catch {} finally { if ($sr) { $sr.Dispose() } }
  $m = $script:RxUuid.Match($f.Name)
  if ($m.Success) { return @($m.Value.ToLowerInvariant(), 'nom de fichier (secours)') }
  return $null
}

function AuditCodex {
  Titre '4. Codex (piloté par T3 Code ou en direct)'
  $racines = New-Object System.Collections.Generic.List[object]
  $v = LireVariable 'CODEX_HOME'
  if ($v.Count -eq 0) { Ecrire '  CODEX_HOME : non défini' }
  foreach ($x in $v) { Ecrire ('  CODEX_HOME ({0}) : {1}' -f (Portee $x.Portee), (Chemin $x.Valeur)); AjouteRacine $racines $x.Valeur ('CODEX_HOME ' + (Portee $x.Portee)) }
  AjouteRacine $racines (Joindre $Profil '.codex') 'défaut'
  foreach ($e in $script:ReglagesT3) { if ($e.Genre -eq 'codex' -and $e.Cle -ne 'binaryPath' -and $e.Valeur) { AjouteRacine $racines $e.Valeur ('réglage T3 ' + $e.Cle) } }
  foreach ($r in $racines) {
    SousTitre ('Racine Codex : {0} (origine : {1})' -f (Chemin $r.Chemin), $r.Origine)
    if (-not [System.IO.Directory]::Exists((Long ($r.Chemin)))) { Ecrire '  absente'; continue }
    $script:CodexTrouve = $true
    if ([System.IO.File]::Exists((Long ((Joindre $r.Chemin 'config.toml'))))) { Ecrire '  config.toml : présent (non ouvert)' }
    $h = Joindre $r.Chemin 'history.jsonl'
    if ([System.IO.File]::Exists((Long ($h)))) { DecrireFichier $h 'history.jsonl' }
    $rollouts = New-Object System.Collections.Generic.List[object]
    $ds = Joindre $r.Chemin 'sessions'
    foreach ($a in (SousDossiers $ds)) { foreach ($m in (SousDossiers $a.FullName)) { foreach ($j in (SousDossiers $m.FullName)) {
          foreach ($f in (Fichiers $j.FullName 'rollout-*.jsonl')) { $rollouts.Add($f) } } } }
    foreach ($f in (Fichiers $ds 'rollout-*.jsonl')) { $rollouts.Add($f) }
    $arch = @(Fichiers (Joindre $r.Chemin 'archived_sessions') '*.jsonl').Count
    $oct = [long]0; $mois = @{}; $sources = @{}; $accord = 0
    foreach ($f in $rollouts) {
      $oct += $f.Length; Incr $mois ($f.LastWriteTime.ToString('yyyy-MM'))
      $id = IdCodex $f
      if ($id) {
        $script:IdsCodex[$id[0]] = 1; Incr $sources $id[1]
        $mn = $script:RxUuid.Match($f.Name); if ($id[1] -eq 'session_meta' -and $mn.Success -and $mn.Value.ToLowerInvariant() -eq $id[0]) { $accord++ }
      } else { Incr $sources 'aucun identifiant' }
    }
    Ecrire ('  rollouts : {0}, {1} ; archivés : {2}' -f $rollouts.Count, (Taille $oct), $arch)
    if ($rollouts.Count -gt 0) {
      Ecrire ('  identifiant de reprise tiré de : {0} ; égal à l''UUID du nom de fichier : {1}/{2}' -f (($sources.GetEnumerator() | Sort-Object Key | ForEach-Object { '{0} = {1}' -f $_.Key, $_.Value }) -join ' ; '), $accord, $(if ($sources.ContainsKey('session_meta')) { $sources['session_meta'] } else { 0 }))
    }
    if ($rollouts.Count -gt 0) {
      $tri = @($rollouts | Sort-Object LastWriteTime)
      Ecrire ('  plus ancien : {0} ; plus récent : {1}' -f (DateCourte $tri[0].LastWriteTime), (DateCourte $tri[-1].LastWriteTime))
      Ecrire ('  par mois : ' + (($mois.GetEnumerator() | Sort-Object Key | ForEach-Object { '{0} = {1}' -f $_.Key, $_.Value }) -join ' ; '))
      $types = @{}; $cles = @{}; $ptypes = @{}; $pcles = @{}; $meta = @{}
      foreach ($f in ($tri | Select-Object -Last 2)) {
        $sr = $null; $n = 0
        try {
          $sr = LecteurTexte $f.FullName
          while ($null -ne ($l = $sr.ReadLine())) {
            $n++; if ($n -gt $MaxLignes) { break }
            if ($l.Length -eq 0 -or $l.Length -gt $script:MaxOctetsLigne) { continue }
            try { $o = ConvertFrom-Json -InputObject $l -ErrorAction Stop } catch { continue }
            $t = Valeur $o.type; Incr $types $t
            foreach ($pp in (Proprietes $o)) { Incr $cles (Cle $pp.Name) }
            if (EstObjet $o.payload) {
              $pt = $t + '/' + (Valeur $o.payload.type); Incr $ptypes $pt
              if (-not $pcles.ContainsKey($t)) { $pcles[$t] = @{} }
              foreach ($pp in $o.payload.PSObject.Properties) { Incr $pcles[$t] (Cle $pp.Name) }
              if ($t -eq 'session_meta') { foreach ($k in 'originator', 'source', 'cli_version', 'model_provider') { if ($null -ne $o.payload.$k) { Incr $meta ($k + '=' + (Valeur $o.payload.$k)) } } }
            }
          }
        } catch {} finally { if ($sr) { $sr.Dispose() } }
      }
      Ecrire '  échantillon (2 rollouts les plus récents) :'
      Ecrire ('    clés de premier niveau : {0}' -f (ListeCles $cles))
      Ecrire '    types :'; EcrireComptes $types '      '
      Ecrire '    type/payload.type :'; EcrireComptes $ptypes '      ' 40
      foreach ($t in ($pcles.Keys | Sort-Object)) { Ecrire ('    clés de payload ({0}) : {1}' -f $t, (ListeCles $pcles[$t])) }
      Ecrire '    session_meta (énumérations) :'; EcrireComptes $meta '      '
    }
  }
}

# ---------------------------------------------------------------------------
# 6. WSL (facultatif), Node, recoupements, synthèse
# ---------------------------------------------------------------------------
function AuditWSL {
  Titre '5. WSL (option -WSL)'
  # Distributions lues dans le registre (lecture seule, ne démarre rien) ; \\wsl$ ne se liste pas comme un dossier.
  $distros = New-Object System.Collections.Generic.List[string]
  try {
    foreach ($k in (Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' -ErrorAction Stop)) {
      $n = [string](Get-ItemProperty -LiteralPath $k.PSPath -Name DistributionName -ErrorAction SilentlyContinue).DistributionName
      if ($n) { $distros.Add($n) }
    }
  } catch { Ecrire '  registre WSL absent ou illisible : aucune distribution déclarée'; return }
  Ecrire ('  distributions déclarées : {0}' -f $distros.Count)
  if (-not $WSL) { Ecrire '  Non sondées (relancer avec -WSL ; cela peut démarrer une distribution).'; return }
  foreach ($nom in $distros) {
    $affiche = $nom; if ($nom -notmatch '^(Ubuntu(-\d+\.\d+)?|Debian|kali-linux|openSUSE[A-Za-z0-9.\-]*|SLES[A-Za-z0-9.\-]*|OracleLinux[A-Za-z0-9_.\-]*|AlmaLinux[A-Za-z0-9.\-]*|FedoraLinux[A-Za-z0-9.\-]*|archlinux|docker-desktop(-data)?)$') { $affiche = 'autre:' + (Hache $nom) }
    $racine = $null
    foreach ($pref in '\\wsl.localhost\', '\\wsl$\') { $c = $pref + $nom; try { if ([System.IO.Directory]::Exists($c)) { $racine = $c; break } } catch {} }
    if (-not $racine) { Ecrire ('  distribution {0} : inaccessible (arrêtée ?)' -f $affiche); continue }
    Ecrire ('  distribution {0} :' -f $affiche)
    $homes = @(SousDossiers (Joindre $racine 'home'))
    if ([System.IO.Directory]::Exists((Joindre $racine 'root'))) { $homes += [System.IO.DirectoryInfo]::new((Joindre $racine 'root')) }
    foreach ($h in $homes) {
      $u = Nom $h.Name
      foreach ($rel in '.t3\userdata\statev2.sqlite', '.t3\userdata\state.sqlite') { $f = Joindre $h.FullName $rel; if ([System.IO.File]::Exists($f)) { DecrireFichier $f ('  utilisateur ' + $u + ' : ' + $rel) } }
      $p = Joindre $h.FullName '.claude\projects'
      if ([System.IO.Directory]::Exists($p)) { $m = MesureDossier $p 100000 3; Ecrire ('    utilisateur {0} : .claude\projects : {1} fichiers, {2}, dernier changement {3}' -f $u, $m.Fichiers, (Taille $m.Octets), (DateCourte $m.Recent)) }
      $c = Joindre $h.FullName '.codex\sessions'
      if ([System.IO.Directory]::Exists($c)) { $m = MesureDossier $c 100000 5; Ecrire ('    utilisateur {0} : .codex\sessions : {1} fichiers, {2}' -f $u, $m.Fichiers, (Taille $m.Octets)) }
    }
  }
}

function SousDossierDe([string]$p, [string]$racine) {
  if ([string]::IsNullOrEmpty($p) -or [string]::IsNullOrEmpty($racine)) { return $false }
  $a = $p.TrimEnd('\', '/') + '\'; $b = $racine.TrimEnd('\', '/') + '\'
  return $a.StartsWith($b, [System.StringComparison]::OrdinalIgnoreCase)
}
function AuditSynchro {
  Titre '6. Dossiers synchronisés (OneDrive, iCloud, Dropbox, Obsidian Sync)'
  # Où ira la future base de connaissances : rien de ce qui est synchronisé ne doit la recevoir.
  $racinesSync = New-Object System.Collections.Generic.List[object]
  foreach ($v in 'OneDrive', 'OneDriveConsumer', 'OneDriveCommercial') { $x = [Environment]::GetEnvironmentVariable($v); if ($x) { $racinesSync.Add(@($v, $x)) } }
  foreach ($rel in 'iCloudDrive', 'Dropbox', 'Google Drive', 'My Drive') { $x = Joindre $Profil $rel; if ([System.IO.Directory]::Exists($x)) { $racinesSync.Add(@($rel, $x)) } }
  Ecrire ('  racines synchronisées trouvées : {0}' -f ($(if ($racinesSync.Count) { ($racinesSync | ForEach-Object { $_[0] }) -join ', ' } else { 'aucune' })))
  $coffre = $null
  foreach ($v in (LireVariable 'REMY_VAULT')) { $coffre = $v.Valeur; break }
  $docs = [Environment]::GetFolderPath('MyDocuments')
  if (-not $coffre -and $docs) { $c = Joindre $docs 'Rémy'; if ([System.IO.Directory]::Exists($c)) { $coffre = $c } }
  $lieux = [ordered]@{ 'Documents' = $docs; '%USERPROFILE%\.remy' = (Joindre $Profil '.remy'); '%USERPROFILE%\.remy\prive' = (Joindre (Joindre $Profil '.remy') 'prive') }
  if ($coffre) { $lieux['coffre Obsidian de Rémy'] = $coffre }
  if ($env:LOCALAPPDATA) { $lieux['%LOCALAPPDATA%'] = $env:LOCALAPPDATA }
  foreach ($k in $lieux.Keys) {
    $p = $lieux[$k]
    $dans = @($racinesSync | Where-Object { SousDossierDe $p $_[1] } | ForEach-Object { $_[0] })
    $script:Synchro[$k] = ($dans.Count -gt 0)
    Ecrire ('  {0} : {1}' -f $k, $(if ($dans.Count) { 'DANS ' + ($dans -join ', ') + ' : synchronisé hors de la tour' } else { 'hors des racines synchronisées connues' }))
  }
  if ($coffre) {
    $cp = Joindre (Joindre $coffre '.obsidian') 'core-plugins.json'
    $etat = 'inconnu (fichier absent)'
    $j = $null; if ([System.IO.File]::Exists($cp)) { $j = LireJsonFichier $cp 1MB }
    if ($j -is [string]) { $j = @($j) }
    if ($j -is [System.Array]) { $etat = $(if ($j -contains 'sync') { 'ACTIVÉ' } else { 'désactivé' }) }
    elseif (EstObjet $j) { $etat = $(if ($j.sync -eq $true) { 'ACTIVÉ' } else { 'désactivé' }) }
    Ecrire ('  Obsidian Sync dans le coffre : {0}' -f $etat)
    $script:Synchro['Obsidian Sync'] = ($etat -eq 'ACTIVÉ')
  } else { Ecrire '  coffre Obsidian : non trouvé (REMY_VAULT non défini dans l''environnement, Documents\Rémy absent)' }
}

function AuditNode {
  Titre '7. Côté Rémy'
  $node = TrouveProgramme @('node.exe', 'node')
  if (-not $node) { Ecrire '  node : introuvable dans le PATH'; return }
  $r = Lance $node @('--version') $null 15000
  $v = $r.Sortie.Trim()
  Ecrire ('  node : {0}' -f (Valeur $v.TrimStart('v')))
  $m = [regex]::Match($v, '^v(\d+)\.(\d+)')
  if ($m.Success) {
    $maj = [int]$m.Groups[1].Value; $min = [int]$m.Groups[2].Value
    $ok2216 = ($maj -gt 22) -or ($maj -eq 22 -and $min -ge 16)
    Ecrire ('  node >= 22.16 (exigé par T3 amont) : {0}' -f $ok2216)
  }
  $drap = @()
  if ($m.Success -and (($maj -eq 22 -and $min -lt 13) -or ($maj -eq 23 -and $min -lt 4))) { $drap = @('--experimental-sqlite') }
  # FTS5 avec remove_diacritics dans le Node de la tour : base en mémoire, aucun fichier.
  $js = "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(':memory:');d.exec(" + '"' + "CREATE VIRTUAL TABLE f USING fts5(t, tokenize='unicode61 remove_diacritics 2');INSERT INTO f VALUES ('mémoire déployée')" + '"' + ");console.log(d.prepare(" + '"' + "SELECT count(*) n FROM f WHERE f MATCH 'memoire'" + '"' + ").get().n)"
  $t = Lance $node (@('--no-warnings') + $drap + @('-e', $js)) $null 20000
  Ecrire ('  FTS5 + remove_diacritics dans node:sqlite (base en mémoire) : {0}' -f $(if ($t.Sortie.Trim() -eq '1') { 'ok' } else { 'échec' }))
  $remy = Joindre $Profil '.remy'
  Ecrire ('  %USERPROFILE%\.remy : {0}' -f ($(if ([System.IO.Directory]::Exists((Long ($remy)))) { 'présent (non parcouru)' } else { 'absent' })))
}

function Recoupements {
  Titre '8. Recoupements (déduplication)'
  Ecrire ('  Sessions Claude Code indexées : {0} ; identifiants Codex (session_meta, sinon nom de fichier) : {1}' -f $script:SessionsClaude.Count, $script:IdsCodex.Count)
  if ($script:NatifsT3.Count -eq 0) { Ecrire '  Aucun identifiant natif lu dans T3 (base absente, T3 ouvert sans -CopieT3, aucun moteur SQL, ou schéma différent).'; return }
  $parF = @{}; $trouves = @{}; $epT3 = @{}; $catT3 = @{}
  foreach ($n in $script:NatifsT3) {
    $f = Valeur $n.Fournisseur
    Incr $parF $f
    if (-not $n.Natif) { Incr $trouves ($f + ' : sans identifiant natif'); continue }
    if ($script:IdsClaude.ContainsKey($n.Natif)) {
      Incr $trouves ($f + ' : JSONL Claude retrouvé')
      $s = $script:SessionsClaude[$script:IdsClaude[$n.Natif]]
      Incr $epT3 (Valeur $s.Entrypoint 'entrypoint'); Incr $catT3 $s.Categorie
    } elseif ($script:IdsCodex.ContainsKey($n.Natif)) { Incr $trouves ($f + ' : rollout Codex retrouvé') }
    else { Incr $trouves ($f + ' : introuvable sur le disque') }
  }
  Ecrire '  provider_threads de T3 par pilote :'; EcrireComptes $parF '    '
  Ecrire '  Correspondance avec les fichiers locaux :'; EcrireComptes $trouves '    '
  Ecrire '  entrypoint des sessions Claude pilotées par T3 :'; EcrireComptes $epT3 '    '
  Ecrire '  catégorie de cwd de ces sessions :'; EcrireComptes $catT3 '    '
  $script:EpT3 = ListeCles $epT3
}

function Synthese {
  Titre '9. Synthèse pour la conception'
  Ecrire '  Rétention Claude Code effective par racine (cleanupPeriodDays ; défaut documenté 30 jours) :'
  $gere = $null; if ($script:RetentionsLues.Count -gt 0) { $gere = ($script:RetentionsLues | Measure-Object -Minimum).Minimum }
  $minRet = $null
  foreach ($r in $script:RacinesClaude) {
    if (-not [System.IO.Directory]::Exists((Long $r.Chemin))) { continue }
    $ret = 30; $src = 'défaut'
    if ($null -ne $r.Retention) { $ret = $r.Retention; $src = 'réglage' }
    if ($null -ne $gere) { $ret = $gere; $src = 'réglage géré (managed-settings)' }
    $txt = '{0} jours ({1})' -f $ret, $src
    if ($r.Invalide) { $txt += ' ; settings illisible : à corriger et contrôler avec /doctor' }
    Ecrire ('    {0} (origine : {1}) : {2}' -f (Chemin $r.Chemin), $r.Origine, $txt)
    if ($null -eq $minRet -or $ret -lt $minRet) { $minRet = $ret }
  }
  if ($null -ne $script:AgeMax) {
    Ecrire ('  Plus vieille session présente : {0} jours' -f $script:AgeMax)
    if ($null -ne $minRet -and $minRet -lt 3650) { Avert ('rétention la plus courte : {0} jours ; pour garder longtemps, cleanupPeriodDays = 3650 dans chaque settings.json concerné (étape 0, décision D1)' -f $minRet) }
  }
  if ($null -ne $script:HistoriqueAncien) { Ecrire ('  Plus vieille entrée de history.jsonl : {0} (il y a {1} jours)' -f (DateCourte $script:HistoriqueAncien), (AgeJours $script:HistoriqueAncien)) }
  Ecrire ('  Sous-agents : {0} transcription(s) directe(s), {1} de workflow ; journaux de workflow : {2}' -f $script:NbSousAgents, $script:NbAgentsWf, $script:NbJournauxWf)
  Ecrire ('  Sessions « claude -p » de Rémy persistées (attendu : 0) : {0}' -f $script:NbRemy)
  Ecrire ('  Sessions de génération de titres T3 persistées : {0}' -f $script:NbTitresT3)
  Ecrire ('  Sessions sdk-cli dans un dossier de projet (générations T3 : commits, PR, branches, revues ; ou tes claude -p) : {0}' -f $script:NbSdkCliProjet)
  Ecrire ('  Sessions dont le cwd est temporaire (autres outils, Hermès ?) : {0}' -f $script:NbTemporaires)
  Ecrire ('  Sessions Claude dont le cwd est un worktree T3 : {0}' -f $script:NbWorktreesT3)
  Ecrire ('  Hooks Claude Code configurés : {0}' -f ($(if ($script:HooksVus.Count) { ($script:HooksVus.Keys | Sort-Object) -join ', ' } else { 'aucun' })))
  $lecture = 'non lue'
  if ($script:T3Ouvert -and -not $CopieT3) { $lecture = 'non lue : T3 ouvert (relancer T3 fermé, ou avec -CopieT3)' }
  elseif ($script:CopieFaite) { $lecture = 'lue sur copie temporaire (supprimée)' }
  elseif ($script:T3BaseV2) { $lecture = 'lue en immutable=1, T3 fermé' }
  Ecrire ('  T3 Code : racine trouvée = {0} ; base V2 : {1} ; moteur : {2} ; plus haute migration = {3} ; migrations propres au fork = {4}' -f [bool]$script:T3Trouve, $lecture, $(if ($script:MoteurSql) { $script:MoteurSql } else { 'aucun' }), $script:T3MigrationMax, $script:T3MigrationsFork)
  if ($CopieT3) { Ecrire ('  Copie pendant que T3 tourne : faite = {0} ; partage refusé par Windows = {1}' -f [bool]$script:CopieFaite, [bool]$script:CopieRefusee) }
  if ($script:EpT3) { Ecrire ('  entrypoint des sessions Claude via T3 : {0}' -f $script:EpT3) }
  Ecrire ('  Codex : racine trouvée = {0}' -f [bool]$script:CodexTrouve)
  $sync = @($script:Synchro.Keys | Where-Object { $script:Synchro[$_] })
  Ecrire ('  Emplacements synchronisés hors de la tour : {0}' -f $(if ($sync.Count) { $sync -join ', ' } else { 'aucun parmi ceux testés' }))
  Ecrire ('  Lignes à motif de secret dans l''échantillon (comptées, jamais affichées) : {0}' -f $script:SecretsEchantillon)
  Ecrire ('  uuid partagés entre fichiers de l''échantillon : {0}' -f $script:UuidPartages)
  if ($script:ErreursDossiers -gt 0) { Ecrire ('  Dossiers illisibles pendant l''inventaire : {0} (droits ou chemins trop longs ; sessions possiblement manquantes)' -f $script:ErreursDossiers) }
  if ($script:Avertissements.Count -gt 0) {
    Ecrire '  Avertissements :'
    foreach ($a in $script:Avertissements) { Ecrire ('    - ' + $a) }
  }
  Ecrire ('  Durée de l''audit : {0:N0} s' -f ((Get-Date) - $script:Debut).TotalSeconds)
}

# ---------------------------------------------------------------------------
# Programme principal
# ---------------------------------------------------------------------------
$script:RacinesClaude = New-Object System.Collections.Generic.List[object]
$script:SessionsClaude = New-Object System.Collections.Generic.List[object]
$script:IdsClaude = @{}
$script:IdsCodex = @{}
$script:NatifsT3 = New-Object System.Collections.Generic.List[object]
$script:RetentionsLues = New-Object System.Collections.Generic.List[int]
$script:HooksVus = @{}
$script:Synchro = [ordered]@{}
$script:ReglagesT3 = New-Object System.Collections.Generic.List[object]
$script:WorktreesFork = New-Object System.Collections.Generic.List[string]
$script:AgeMax = $null; $script:HistoriqueAncien = $null; $script:NbRemy = 0; $script:NbTitresT3 = 0; $script:NbWorktreesT3 = 0
$script:NbSdkCliProjet = 0; $script:NbTemporaires = 0; $script:NbSousAgents = 0; $script:NbAgentsWf = 0; $script:NbJournauxWf = 0
$script:T3Trouve = $false; $script:T3BaseV2 = $false; $script:T3MigrationMax = 0; $script:T3MigrationsFork = 0; $script:EpT3 = ''
$script:T3Ouvert = $false; $script:ProcT3 = $false; $script:CopieFaite = $false; $script:CopieRefusee = $false; $script:CopieIncoherente = $false
$script:MoteurSql = $null; $script:Node = $null; $script:Sqlite3Exe = $null; $script:NodeDrapeaux = @(); $script:Sqlite3Drapeaux = @()
$script:CodexTrouve = $false; $script:SecretsEchantillon = 0; $script:UuidPartages = 0; $script:ErreursDossiers = 0

try {
  EnTete
  PurgeCopiesAnciennes
  ListeWorktreesFork
  DecouvreReglagesT3
  AuditClaude
  AuditT3
  AuditCodex
  AuditWSL
  AuditSynchro
  AuditNode
  Recoupements
  Synthese
} catch {
  Avert ('Erreur inattendue, audit incomplet : ' + (NettoieMessage $_.Exception.Message))
} finally {
  # Écriture du rapport (toujours masqué), dans %USERPROFILE%\.remy\prive.
  $dossier = Joindre (Joindre $Profil '.remy') 'prive'
  $fichier = Joindre $dossier ('audit-sources-' + (Get-Date -Format 'yyyy-MM-dd_HHmmss') + '.txt')
  try {
    [void][System.IO.Directory]::CreateDirectory($dossier)
    [System.IO.File]::WriteAllLines($fichier, $script:Lignes.ToArray(), (New-Object System.Text.UTF8Encoding($true)))
    Write-Host ''
    Write-Host ('Rapport écrit : ' + $fichier)
    Write-Host 'Relis-le avant de le transmettre : il ne contient que des structures, des comptes et des hachages.'
  } catch {
    Write-Host ('Impossible d''écrire le rapport : ' + $_.Exception.Message)
  }
  if ($AfficherNoms) {
    # À l'écran seulement, jamais dans un fichier : pour désigner les projets d'essai par leur hachage.
    Write-Host ''
    Write-Host 'TABLE HACHAGE -> NOM (écran seulement, rien n''est écrit ; ne pas copier dans un message) :'
    foreach ($e in ($script:Revelations.GetEnumerator() | Sort-Object Value)) { Write-Host ('  {0}  {1}' -f $e.Key, $e.Value) }
  }
}

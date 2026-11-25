import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
  alpha,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import CloudRoundedIcon from '@mui/icons-material/CloudRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import { api, ApiError } from '../api/client';
import type { CatalogSnapshot, Channel, ModelTemplate, ProviderTemplate, PublicModel } from '../api/types';
import { PageHeader, SectionCard } from '../components/PageHeader';
import { DataTable, ErrorAlert, StatusChip } from '../components/DataTable';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { formatCompact, formatDateTime } from '../utils/format';

const protocols = [
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'openai-completions', label: 'OpenAI Chat Completions' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
  { value: 'azure-openai-responses', label: 'Azure OpenAI Responses' },
  { value: 'azure-openai-completions', label: 'Azure OpenAI Completions' },
];

const modelStatuses = [
  { value: 'enabled', label: '启用' },
  { value: 'gray', label: '灰度' },
  { value: 'disabled', label: '停用' },
];

interface ChannelForm {
  name: string;
  base_url: string;
  api_key: string;
  status: string;
}

interface ModelForm {
  display_name: string;
  status: string;
  context_window: number;
  max_tokens: number;
}

export function ModelsPage() {
  const [models, setModels] = useState<PublicModel[] | null>(null);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [providers, setProviders] = useState<ProviderTemplate[]>([]);
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderTemplate | null>(null);
  const [providerModels, setProviderModels] = useState<ModelTemplate[] | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [modelSearch, setModelSearch] = useState('');
  const [includeDeprecated, setIncludeDeprecated] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [protocol, setProtocol] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  const [editChannel, setEditChannel] = useState<Channel | null>(null);
  const [channelForm, setChannelForm] = useState<ChannelForm>({ name: '', base_url: '', api_key: '', status: 'enabled' });
  const [channelBusy, setChannelBusy] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  const [editModel, setEditModel] = useState<PublicModel | null>(null);
  const [modelForm, setModelForm] = useState<ModelForm>({ display_name: '', status: 'enabled', context_window: 0, max_tokens: 0 });
  const [modelBusy, setModelBusy] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [disableModel, setDisableModel] = useState<PublicModel | null>(null);

  const loadBase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [modelRows, channelRows, providerRows, snapshots] = await Promise.all([
        api<PublicModel[]>('/api/v1/admin/models'),
        api<Channel[]>('/api/v1/admin/channels'),
        api<ProviderTemplate[]>('/api/v1/admin/catalog/providers?limit=400'),
        api<CatalogSnapshot[]>('/api/v1/admin/catalog/snapshots'),
      ]);
      setModels(modelRows);
      setChannels(channelRows);
      setProviders(providerRows);
      setSnapshot(snapshots.find((item) => item.is_current) ?? snapshots[0] ?? null);
      return { modelRows, channelRows, providerRows };
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '加载供应商与模型失败。');
      return { modelRows: [] as PublicModel[], channelRows: [] as Channel[], providerRows: [] as ProviderTemplate[] };
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  const loadProviderModels = async (provider: ProviderTemplate, withDeprecated: boolean) => {
    setModelsLoading(true);
    setProviderModels(null);
    setSelectedKeys([]);
    try {
      const result = await api<{ models: ModelTemplate[] }>(
        `/api/v1/admin/catalog/providers/${encodeURIComponent(provider.provider_key)}/models?include_deprecated=${withDeprecated}`,
      );
      setProviderModels(result.models);
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : '加载供应商模型失败。');
    } finally {
      setModelsLoading(false);
    }
  };

  const chooseProvider = async (provider: ProviderTemplate) => {
    setSelectedProvider(provider);
    setSelectedKeys([]);
    setModelSearch('');
    setImportError(null);
    setImportNotice(null);
    const existing = channels.find((channel) => channel.provider_key === provider.provider_key && channel.status !== 'disabled');
    setChannelName(existing?.name ?? `${provider.name} 连接`);
    setBaseUrl(existing?.base_url ?? provider.base_url ?? '');
    setProtocol(existing?.protocol ?? provider.protocol_suggestion ?? 'openai-completions');
    setApiKey('');
    await loadProviderModels(provider, includeDeprecated);
  };

  const openAdd = (provider?: ProviderTemplate) => {
    setDrawerOpen(true);
    setSelectedProvider(null);
    setProviderModels(null);
    setSelectedKeys([]);
    setModelSearch('');
    setImportError(null);
    setImportNotice(null);
    setChannelName('');
    setBaseUrl('');
    setProtocol('');
    setApiKey('');
    if (provider) void chooseProvider(provider);
  };

  const existingChannel = useMemo(
    () =>
      selectedProvider
        ? channels.find((channel) => channel.provider_key === selectedProvider.provider_key && channel.status !== 'disabled')
        : undefined,
    [channels, selectedProvider],
  );

  const importedUpstreams = useMemo(() => {
    const imported = new Set<string>();
    if (!selectedProvider) return imported;
    for (const model of models ?? []) {
      const sameProvider =
        model.provider_key === selectedProvider.provider_key || model.channel_provider_key === selectedProvider.provider_key;
      if (sameProvider && model.upstream_model) imported.add(model.upstream_model);
    }
    return imported;
  }, [models, selectedProvider]);

  const visibleModels = useMemo(
    () =>
      (providerModels ?? []).filter(
        (model) =>
          !modelSearch.trim() ||
          model.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
          model.model_key.toLowerCase().includes(modelSearch.toLowerCase()),
      ),
    [providerModels, modelSearch],
  );

  const selectableVisible = visibleModels.filter((model) => !importedUpstreams.has(model.model_key));

  const runImport = async () => {
    if (!selectedProvider || selectedKeys.length === 0) return;
    if (!existingChannel && (!channelName.trim() || !protocol)) {
      setImportError('请填写连接名称并选择协议。');
      return;
    }
    setImporting(true);
    setImportError(null);
    setImportNotice(null);
    try {
      const result = await api<{ public_model_ids: string[]; skipped: string[]; warning: string | null }>(
        '/api/v1/admin/catalog/import',
        {
          method: 'POST',
          body: JSON.stringify({
            provider_key: selectedProvider.provider_key,
            model_keys: selectedKeys,
            channel_id: existingChannel?.id ?? null,
            channel_name: existingChannel ? null : channelName.trim(),
            base_url: existingChannel ? null : baseUrl.trim() || null,
            api_key: existingChannel ? null : apiKey.trim() || null,
            protocol: existingChannel ? null : protocol,
            headers_json: null,
            alias_prefix: null,
            publish: true,
          }),
        },
      );
      setImportNotice(
        `已添加 ${result.public_model_ids.length} 个模型${result.skipped.length ? `，跳过 ${result.skipped.length} 个` : ''}${result.warning ? `。${result.warning}` : ''}。`,
      );
      setSelectedKeys([]);
      const refreshed = await loadBase();
      const updated = refreshed.providerRows.find((provider) => provider.id === selectedProvider.id);
      if (updated) {
        setSelectedProvider(updated);
        await loadProviderModels(updated, includeDeprecated);
      }
    } catch (err) {
      setImportError(err instanceof ApiError ? err.message : '添加供应商失败。');
    } finally {
      setImporting(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ providers: number; models: number; error: string | null }>('/api/v1/admin/catalog/sync', { method: 'POST' });
      setNotice(result.error ? `同步失败：${result.error}` : `models.dev 已同步：${result.providers} 个供应商 / ${result.models} 个模型。`);
      await loadBase();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '同步 models.dev 失败。');
    } finally {
      setSyncing(false);
    }
  };

  const openEditChannel = (channel: Channel) => {
    setEditChannel(channel);
    setChannelForm({ name: channel.name, base_url: channel.base_url, api_key: channel.api_key_masked, status: channel.status });
    setChannelError(null);
  };

  const saveChannel = async () => {
    if (!editChannel) return;
    setChannelBusy(true);
    setChannelError(null);
    try {
      await api(`/api/v1/admin/channels/${editChannel.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: channelForm.name,
          provider_key: editChannel.provider_key,
          protocol: editChannel.protocol,
          base_url: channelForm.base_url,
          api_key: channelForm.api_key.includes('****') ? null : channelForm.api_key,
          headers_json: null,
          status: channelForm.status,
          max_concurrency: editChannel.max_concurrency,
        }),
      });
      setEditChannel(null);
      await loadBase();
    } catch (err) {
      setChannelError(err instanceof ApiError ? err.message : '保存连接失败。');
    } finally {
      setChannelBusy(false);
    }
  };

  const openEditModel = (model: PublicModel) => {
    setEditModel(model);
    setModelForm({
      display_name: model.display_name,
      status: model.status,
      context_window: model.context_window,
      max_tokens: model.max_tokens,
    });
    setModelError(null);
  };

  const saveModel = async () => {
    if (!editModel) return;
    setModelBusy(true);
    setModelError(null);
    try {
      await api(`/api/v1/admin/models/${editModel.id}`, { method: 'PUT', body: JSON.stringify(modelForm) });
      setEditModel(null);
      await loadBase();
    } catch (err) {
      setModelError(err instanceof ApiError ? err.message : '保存模型失败。');
    } finally {
      setModelBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="供应商与模型"
        subtitle="从 models.dev 搜索供应商，勾选模型并确认连接信息即可。模型直接绑定供应商，不再需要配置路由。"
        actions={
          <>
            <Button
              variant="outlined"
              startIcon={syncing ? <CircularProgress size={16} /> : <SyncRoundedIcon />}
              onClick={() => void sync()}
              disabled={syncing}
            >
              同步 models.dev
            </Button>
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => openAdd()}>
              添加供应商
            </Button>
          </>
        }
      />
      <ErrorAlert error={error} />
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <SectionCard
        title="已接入供应商"
        subtitle={
          snapshot
            ? `共 ${channels.length} 个连接 · models.dev 快照 ${snapshot.id}（${formatDateTime(snapshot.fetched_at)}）`
            : '尚未同步 models.dev'
        }
        sx={{ mb: 3 }}
      >
        {loading ? (
          <Box sx={{ py: 6, display: 'grid', placeItems: 'center' }}>
            <CircularProgress size={28} />
          </Box>
        ) : channels.length === 0 ? (
          <Alert severity="info">还没有供应商。点击右上角「添加供应商」，从 models.dev 选择供应商和模型即可。</Alert>
        ) : (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' }, gap: 1.75 }}>
            {channels.map((channel) => {
              const provider = providers.find((item) => item.provider_key === channel.provider_key);
              return (
                <Box
                  key={channel.id}
                  sx={{
                    p: 2.25,
                    borderRadius: '15px',
                    border: 1,
                    borderColor: 'divider',
                    transition: 'border-color .18s ease, box-shadow .18s ease, transform .18s ease',
                    '&:hover': {
                      borderColor: 'secondary.main',
                      transform: 'translateY(-2px)',
                      boxShadow: (theme) => alpha(theme.palette.secondary.main, 0.12) + ' 0 18px 38px',
                    },
                  }}
                >
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box
                      sx={{
                        width: 42,
                        height: 42,
                        borderRadius: '13px',
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: (theme) => alpha(theme.palette.secondary.main, 0.12),
                        color: 'secondary.main',
                      }}
                    >
                      <CloudRoundedIcon fontSize="small" />
                    </Box>
                    <StatusChip status={channel.status} />
                  </Stack>

                  <Typography variant="h4" sx={{ mt: 1.75 }} noWrap>
                    {channel.name}
                  </Typography>
                  <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace' }} noWrap>
                      {channel.provider_key ?? '自定义'}
                    </Typography>
                    <Chip size="small" label={channel.protocol} variant="outlined" />
                  </Stack>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    display="block"
                    noWrap
                    sx={{ mt: 1.1, fontFamily: 'ui-monospace, monospace' }}
                  >
                    {channel.base_url}
                  </Typography>

                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
                    <Box>
                      <Typography sx={{ fontSize: '1.25rem', fontWeight: 760, lineHeight: 1.2 }}>{channel.model_count}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        个模型
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={0.75}>
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<AddRoundedIcon />}
                        disabled={!provider}
                        onClick={() => provider && openAdd(provider)}
                      >
                        添加模型
                      </Button>
                      <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => openEditChannel(channel)}>
                        编辑
                      </Button>
                    </Stack>
                  </Stack>
                </Box>
              );
            })}
          </Box>
        )}
      </SectionCard>

      <SectionCard title="模型" subtitle="插件可见的公共模型；每个模型直接绑定一个供应商连接与上游模型">
        <DataTable
          loading={loading}
          rows={models}
          getKey={(row) => row.id}
          emptyText="还没有模型。点击「添加供应商」从 models.dev 导入。"
          columns={[
            {
              key: 'alias',
              label: '模型',
              render: (row) => (
                <Box>
                  <Typography variant="body2" fontWeight={650} sx={{ fontFamily: 'ui-monospace, monospace' }}>
                    {row.alias}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {row.display_name}
                  </Typography>
                </Box>
              ),
            },
            {
              key: 'provider',
              label: '供应商',
              render: (row) => <Chip size="small" label={row.provider_key ?? row.channel_provider_key ?? '手动'} variant="outlined" />,
            },
            {
              key: 'upstream',
              label: '上游模型 / 连接',
              render: (row) =>
                row.bound ? (
                  <Box>
                    <Typography variant="caption" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                      {row.upstream_model}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" display="block">
                      {row.channel_name}
                    </Typography>
                  </Box>
                ) : (
                  <Chip size="small" color="warning" variant="outlined" label="未绑定" />
                ),
            },
            { key: 'api', label: '协议', render: (row) => <Chip size="small" label={row.api} variant="outlined" /> },
            {
              key: 'context',
              label: '上下文 / 输出',
              align: 'right',
              render: (row) => `${formatCompact(row.context_window)} / ${formatCompact(row.max_tokens)}`,
            },
            {
              key: 'reasoning',
              label: '推理',
              render: (row) =>
                row.reasoning ? <Chip size="small" label="支持" color="secondary" variant="outlined" /> : <Typography variant="caption" color="text.secondary">-</Typography>,
            },
            { key: 'status', label: '状态', render: (row) => <StatusChip status={row.status} /> },
            {
              key: 'actions',
              label: '',
              align: 'right',
              render: (row) => (
                <Stack direction="row" spacing={0.25} justifyContent="flex-end">
                  <IconButton size="small" onClick={() => openEditModel(row)} aria-label="编辑模型">
                    <EditRoundedIcon fontSize="small" />
                  </IconButton>
                  {row.status !== 'disabled' && (
                    <IconButton size="small" color="error" onClick={() => setDisableModel(row)} aria-label="停用模型">
                      <BlockRoundedIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
              ),
            },
          ]}
        />
      </SectionCard>

      {/* Add provider drawer */}
      <Drawer anchor="right" open={drawerOpen} onClose={() => setDrawerOpen(false)} slotProps={{ paper: { sx: { width: { xs: '100%', md: 760 } } } }}>
        <Stack sx={{ height: '100%' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider' }}>
            <Box>
              <Typography variant="h3">添加供应商</Typography>
              <Typography variant="caption" color="text.secondary">
                搜索 models.dev → 选择模型 → 确认连接信息
              </Typography>
            </Box>
            <IconButton onClick={() => setDrawerOpen(false)} aria-label="关闭">
              <CloseRoundedIcon />
            </IconButton>
          </Stack>

          <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5 }}>
            <Autocomplete
              options={providers}
              value={selectedProvider}
              onChange={(_, value) => {
                if (value) void chooseProvider(value);
              }}
              getOptionLabel={(option) => `${option.name} · ${option.provider_key}`}
              isOptionEqualToValue={(a, b) => a.id === b.id}
              renderInput={(params) => (
                <TextField {...params} label="搜索 models.dev 供应商" placeholder="如 anthropic、openai、deepseek" />
              )}
              noOptionsText="没有匹配的供应商，请先同步 models.dev"
            />

            {selectedProvider && (
              <Stack spacing={2.5} sx={{ mt: 2.5 }}>
                <Box sx={{ p: 1.75, borderRadius: 2, bgcolor: 'action.hover' }}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                    <Typography variant="body2" fontWeight={700}>
                      {selectedProvider.name}
                    </Typography>
                    <Chip size="small" label={selectedProvider.provider_key} sx={{ fontFamily: 'ui-monospace, monospace' }} />
                    <Chip size="small" label={`${selectedProvider.model_count} 个模型`} variant="outlined" />
                    {selectedProvider.env_names.length > 0 && (
                      <Typography variant="caption" color="text.secondary">
                        Key 名称：{selectedProvider.env_names.join(' / ')}
                      </Typography>
                    )}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                    {selectedProvider.base_url || '模板未提供 Base URL'}
                  </Typography>
                </Box>

                {existingChannel ? (
                  <Alert severity="info">
                    已存在连接「{existingChannel.name}」，本次将直接复用该连接，只添加新模型。
                  </Alert>
                ) : (
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                    <TextField label="连接名称" value={channelName} onChange={(event) => setChannelName(event.target.value)} helperText="仅管理端可见" fullWidth />
                    <TextField select label="协议" value={protocol} onChange={(event) => setProtocol(event.target.value)} helperText="已按 models.dev 模板预填" fullWidth>
                      {protocols.map((item) => (
                        <MenuItem key={item.value} value={item.value}>
                          {item.label}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      label="Base URL"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      helperText="留空使用模板或协议默认地址"
                      sx={{ gridColumn: { sm: 'span 2' } }}
                      fullWidth
                    />
                    <TextField
                      label="API Key"
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      helperText="加密存储，只写不读"
                      sx={{ gridColumn: { sm: 'span 2' } }}
                      fullWidth
                      autoComplete="new-password"
                    />
                  </Box>
                )}

                <Box>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                    <Typography variant="h4">选择模型（已选 {selectedKeys.length}）</Typography>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Button
                        size="small"
                        onClick={() =>
                          setSelectedKeys(
                            selectableVisible.every((model) => selectedKeys.includes(model.model_key))
                              ? []
                              : selectableVisible.map((model) => model.model_key),
                          )
                        }
                        disabled={selectableVisible.length === 0}
                      >
                        全选可添加
                      </Button>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={includeDeprecated}
                            onChange={(event) => {
                              const value = event.target.checked;
                              setIncludeDeprecated(value);
                              if (selectedProvider) void loadProviderModels(selectedProvider, value);
                            }}
                          />
                        }
                        label="含 beta / 旧模型"
                      />
                    </Stack>
                  </Stack>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="筛选模型名称或 ID"
                    value={modelSearch}
                    onChange={(event) => setModelSearch(event.target.value)}
                    InputProps={{ startAdornment: <InputAdornment position="start"><SearchRoundedIcon fontSize="small" /></InputAdornment> }}
                    sx={{ mb: 1.5 }}
                  />
                  {modelsLoading && (
                    <Box sx={{ py: 5, display: 'grid', placeItems: 'center' }}>
                      <CircularProgress size={28} />
                    </Box>
                  )}
                  {!modelsLoading && visibleModels.length === 0 && <Alert severity="info">没有可添加的模型。</Alert>}
                  {!modelsLoading && visibleModels.length > 0 && (
                    <Box sx={{ maxHeight: 360, overflowY: 'auto', pr: 0.5 }}>
                      <Stack spacing={1}>
                        {visibleModels.map((model) => {
                          const imported = importedUpstreams.has(model.model_key);
                          const checked = selectedKeys.includes(model.model_key);
                          return (
                            <Box
                              key={model.id}
                              onClick={() => {
                                if (imported) return;
                                setSelectedKeys((current) =>
                                  current.includes(model.model_key)
                                    ? current.filter((key) => key !== model.model_key)
                                    : [...current, model.model_key],
                                );
                              }}
                              sx={{
                                p: 1.5,
                                borderRadius: 2,
                                border: 1,
                                cursor: imported ? 'default' : 'pointer',
                                opacity: imported ? 0.65 : 1,
                                borderColor: checked ? 'primary.main' : 'divider',
                                bgcolor: checked ? (theme) => alpha(theme.palette.primary.main, 0.06) : 'transparent',
                              }}
                            >
                              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                                <Checkbox checked={checked} disabled={imported} size="small" sx={{ p: 0.5 }} />
                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                    <Typography variant="body2" fontWeight={650}>
                                      {model.name}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'ui-monospace, monospace' }}>
                                      {model.model_key}
                                    </Typography>
                                    {model.reasoning && <Chip size="small" label="推理" color="secondary" variant="outlined" />}
                                    {imported && <Chip size="small" label="已添加" color="success" variant="outlined" />}
                                  </Stack>
                                  <Typography variant="caption" color="text.secondary" display="block">
                                    上下文 {formatCompact(model.context_limit ?? 0)} · 输出 {formatCompact(model.output_limit ?? 0)}
                                    {model.family ? ` · ${model.family}` : ''}
                                  </Typography>
                                </Box>
                              </Stack>
                            </Box>
                          );
                        })}
                      </Stack>
                    </Box>
                  )}
                </Box>

                {importNotice && <Alert severity="success">{importNotice}</Alert>}
                {importError && <Alert severity="error">{importError}</Alert>}
              </Stack>
            )}
          </Box>

          <Box sx={{ p: 2.5, borderTop: 1, borderColor: 'divider' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="caption" color="text.secondary">
                {selectedProvider
                  ? existingChannel
                    ? `将向「${existingChannel.name}」添加 ${selectedKeys.length} 个模型`
                    : `将创建 1 个连接并添加 ${selectedKeys.length} 个模型`
                  : '请选择供应商'}
              </Typography>
              <Button
                variant="contained"
                startIcon={<AutoAwesomeRoundedIcon />}
                disabled={!selectedProvider || selectedKeys.length === 0 || importing}
                onClick={() => void runImport()}
              >
                {importing ? '添加中…' : selectedKeys.length > 0 ? `添加 ${selectedKeys.length} 个模型` : '添加模型'}
              </Button>
            </Stack>
          </Box>
        </Stack>
      </Drawer>

      {/* Edit connection */}
      <Dialog open={Boolean(editChannel)} onClose={() => setEditChannel(null)} maxWidth="xs" fullWidth>
        <DialogTitle>编辑连接 · {editChannel?.name}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {channelError && <Alert severity="error">{channelError}</Alert>}
            <TextField label="连接名称" value={channelForm.name} onChange={(event) => setChannelForm({ ...channelForm, name: event.target.value })} fullWidth />
            <TextField label="Base URL" value={channelForm.base_url} onChange={(event) => setChannelForm({ ...channelForm, base_url: event.target.value })} fullWidth />
            <TextField
              label="API Key"
              type="password"
              value={channelForm.api_key}
              onChange={(event) => setChannelForm({ ...channelForm, api_key: event.target.value })}
              helperText="保留掩码表示不修改；输入新值将轮换密钥"
              fullWidth
              autoComplete="new-password"
            />
            <TextField select label="状态" value={channelForm.status} onChange={(event) => setChannelForm({ ...channelForm, status: event.target.value })} fullWidth>
              <MenuItem value="enabled">启用</MenuItem>
              <MenuItem value="maintenance">维护中</MenuItem>
              <MenuItem value="disabled">停用</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditChannel(null)}>取消</Button>
          <Button variant="contained" onClick={() => void saveChannel()} disabled={channelBusy || !channelForm.name || !channelForm.base_url}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit model */}
      <Dialog open={Boolean(editModel)} onClose={() => setEditModel(null)} maxWidth="xs" fullWidth>
        <DialogTitle>编辑模型 · {editModel?.alias}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {modelError && <Alert severity="error">{modelError}</Alert>}
            <TextField label="显示名" value={modelForm.display_name} onChange={(event) => setModelForm({ ...modelForm, display_name: event.target.value })} fullWidth />
            <TextField select label="状态" value={modelForm.status} onChange={(event) => setModelForm({ ...modelForm, status: event.target.value })} fullWidth>
              {modelStatuses.map((item) => (
                <MenuItem key={item.value} value={item.value}>
                  {item.label}
                </MenuItem>
              ))}
            </TextField>
            <TextField label="上下文窗口" type="number" value={modelForm.context_window} onChange={(event) => setModelForm({ ...modelForm, context_window: Number(event.target.value) })} fullWidth />
            <TextField label="最大输出 Token" type="number" value={modelForm.max_tokens} onChange={(event) => setModelForm({ ...modelForm, max_tokens: Number(event.target.value) })} fullWidth />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditModel(null)}>取消</Button>
          <Button variant="contained" onClick={() => void saveModel()} disabled={modelBusy}>
            保存
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={Boolean(disableModel)}
        title="停用模型"
        description={`确定停用「${disableModel?.alias ?? ''}」吗？插件下一次刷新目录后将不再看到该模型。`}
        destructive
        confirmText="停用"
        onClose={() => setDisableModel(null)}
        onConfirm={async () => {
          if (!disableModel) return;
          try {
            await api(`/api/v1/admin/models/${disableModel.id}`, { method: 'DELETE' });
            await loadBase();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : '停用模型失败。');
          }
        }}
      />
    </>
  );
}
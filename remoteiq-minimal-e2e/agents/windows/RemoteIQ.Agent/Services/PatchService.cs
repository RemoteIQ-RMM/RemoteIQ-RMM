// RemoteIQ.Agent/Services/PatchService.cs

using System.Runtime.Versioning;
using System.Runtime.InteropServices;

namespace RemoteIQ.Agent.Services;

[SupportedOSPlatform("windows")]
public sealed class PatchService
{
    public sealed record PatchItem(
        string Id,
        string Title,
        string? Severity,
        bool RequiresReboot,
        string[] KbIds
    );

    public List<PatchItem> ScanWindowsUpdates(bool includeOptional)
    {
        // Uses Windows Update Agent COM API (no PS module required)
        var sessionType = Type.GetTypeFromProgID("Microsoft.Update.Session")
                         ?? throw new InvalidOperationException("Windows Update COM API not available (Microsoft.Update.Session).");

        dynamic session = Activator.CreateInstance(sessionType)!;
        dynamic searcher = session.CreateUpdateSearcher();

        // Only software updates not installed (you can expand later)
        string criteria = "IsInstalled=0 and Type='Software'";
        dynamic result = searcher.Search(criteria);

        var list = new List<PatchItem>();

        int count = 0;
        try { count = (int)result.Updates.Count; } catch { /* ignore */ }

        for (int i = 0; i < count; i++)
        {
            dynamic upd = result.Updates.Item(i);

            // Optional filtering: treat “optional” as non-auto-selected
            // Many “optional” updates have AutoSelectOnWebSites=false
            bool autoSelect = false;
            try { autoSelect = (bool)upd.AutoSelectOnWebSites; } catch { /* ignore */ }

            if (!includeOptional && !autoSelect)
                continue;

            string title = "";
            try { title = (string)(upd.Title ?? ""); } catch { /* ignore */ }

            string? severity = null;
            try
            {
                var sev = upd.MsrcSeverity as string;
                severity = string.IsNullOrWhiteSpace(sev) ? null : sev.Trim();
            }
            catch
            {
                // ignore
            }

            bool reboot = false;
            try { reboot = (bool)upd.RebootRequired; } catch { /* ignore */ }

            // KB IDs (may be empty)
            var kbIds = Array.Empty<string>();
            try
            {
                int kbCount = (int)upd.KBArticleIDs.Count;
                if (kbCount > 0)
                {
                    var tmp = new List<string>(kbCount);
                    for (int k = 0; k < kbCount; k++)
                    {
                        var kb = upd.KBArticleIDs.Item(k) as string;
                        if (!string.IsNullOrWhiteSpace(kb))
                            tmp.Add(kb.Trim());
                    }
                    kbIds = tmp.ToArray();
                }
            }
            catch
            {
                // ignore
            }

            // Stable ID: prefer first KB, else UpdateID
            string id;
            if (kbIds.Length > 0)
            {
                var first = kbIds[0];
                id = first.StartsWith("KB", StringComparison.OrdinalIgnoreCase) ? first : $"KB{first}";
            }
            else
            {
                try
                {
                    id = (string)upd.Identity.UpdateID;
                }
                catch
                {
                    // last resort (should be rare)
                    id = Guid.NewGuid().ToString("D");
                }
            }

            list.Add(new PatchItem(
                Id: id,
                Title: title,
                Severity: severity,
                RequiresReboot: reboot,
                KbIds: kbIds
            ));
        }

        return list;
    }

    public (bool ok, string stdout, string? stderr, bool requiresReboot) InstallWindowsUpdatesByIds(string[] ids, bool includeOptional)
    {
        if (ids is null || ids.Length == 0)
            return (true, "No update IDs provided.", null, false);

        try
        {
            var sessionType = Type.GetTypeFromProgID("Microsoft.Update.Session")
                             ?? throw new InvalidOperationException("Windows Update COM API not available (Microsoft.Update.Session).");

            dynamic session = Activator.CreateInstance(sessionType)!;
            dynamic searcher = session.CreateUpdateSearcher();

            string criteria = "IsInstalled=0 and Type='Software'";
            dynamic result = searcher.Search(criteria);

            var collType = Type.GetTypeFromProgID("Microsoft.Update.UpdateColl")
                          ?? throw new InvalidOperationException("Windows Update COM API not available (Microsoft.Update.UpdateColl).");

            dynamic updatesToInstall = Activator.CreateInstance(collType)!;

            int count = 0;
            try { count = (int)result.Updates.Count; } catch { /* ignore */ }

            for (int i = 0; i < count; i++)
            {
                dynamic upd = result.Updates.Item(i);

                bool autoSelect = false;
                try { autoSelect = (bool)upd.AutoSelectOnWebSites; } catch { /* ignore */ }

                if (!includeOptional && !autoSelect)
                    continue;

                // Compute id same way as scan
                string computedId = ComputeUpdateId(upd);

                if (ids.Contains(computedId, StringComparer.OrdinalIgnoreCase))
                {
                    updatesToInstall.Add(upd);
                }
            }

            int toInstall = 0;
            try { toInstall = (int)updatesToInstall.Count; } catch { /* ignore */ }

            if (toInstall == 0)
                return (true, "No matching updates to install.", null, false);

            // Download first
            dynamic downloader = session.CreateUpdateDownloader();
            downloader.Updates = updatesToInstall;
            dynamic dlResult = downloader.Download();

            // Install
            dynamic installer = session.CreateUpdateInstaller();
            installer.Updates = updatesToInstall;
            dynamic instResult = installer.Install();

            bool reboot = false;
            try { reboot = (bool)instResult.RebootRequired; } catch { /* ignore */ }

            var stdout = $"Installed {toInstall} update(s). ResultCode={instResult.ResultCode}. RebootRequired={reboot}";
            return (true, stdout, null, reboot);
        }
        catch (COMException cex)
        {
            return (false, "", $"COM error: {cex.Message}", false);
        }
        catch (Exception ex)
        {
            return (false, "", ex.Message, false);
        }
    }

    private static string ComputeUpdateId(dynamic upd)
    {
        try
        {
            // Prefer first KB if available
            int kbCount = 0;
            try { kbCount = (int)upd.KBArticleIDs.Count; } catch { kbCount = 0; }

            if (kbCount > 0)
            {
                var kb0 = upd.KBArticleIDs.Item(0) as string;
                if (!string.IsNullOrWhiteSpace(kb0))
                {
                    var kb = kb0.Trim();
                    return kb.StartsWith("KB", StringComparison.OrdinalIgnoreCase) ? kb : $"KB{kb}";
                }
            }
        }
        catch
        {
            // ignore and fallback
        }

        try
        {
            return (string)upd.Identity.UpdateID;
        }
        catch
        {
            return Guid.NewGuid().ToString("D");
        }
    }
}

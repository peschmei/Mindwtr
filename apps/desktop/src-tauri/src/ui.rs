use crate::*;

const QUICK_ADD_WINDOW_WIDTH: f64 = 620.0;
const QUICK_ADD_WINDOW_HEIGHT: f64 = 420.0;

#[tauri::command]
pub(crate) fn consume_quick_add_pending(
    state: tauri::State<'_, QuickAddPending>,
    target: Option<String>,
) -> bool {
    let requested_target = target.as_deref();
    let Ok(mut pending_target) = state.0.lock() else {
        return false;
    };
    let Some(current_target) = pending_target.as_deref() else {
        return false;
    };
    if requested_target.is_some_and(|target| target != current_target) {
        return false;
    }
    *pending_target = None;
    true
}

#[tauri::command]
pub(crate) fn acknowledge_close_request(state: tauri::State<'_, CloseRequestHandled>) {
    state.0.store(true, Ordering::SeqCst);
}

fn normalize_global_quick_add_shortcut(shortcut: Option<&str>) -> Result<Option<String>, String> {
    let trimmed = shortcut.map(str::trim).unwrap_or("");
    if trimmed.is_empty() {
        return Ok(Some(default_global_quick_add_shortcut().to_string()));
    }

    if trimmed.eq_ignore_ascii_case(GLOBAL_QUICK_ADD_SHORTCUT_DISABLED) {
        return Ok(None);
    }

    if trimmed == GLOBAL_QUICK_ADD_SHORTCUT_DEFAULT
        || trimmed == GLOBAL_QUICK_ADD_SHORTCUT_ALTERNATE_N
        || trimmed == GLOBAL_QUICK_ADD_SHORTCUT_ALTERNATE_Q
        || trimmed == GLOBAL_QUICK_ADD_SHORTCUT_LEGACY
    {
        return Ok(Some(trimmed.to_string()));
    }

    Err("Unsupported quick add shortcut".to_string())
}

pub(crate) fn apply_global_quick_add_shortcut(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, GlobalQuickAddShortcutState>,
    shortcut: Option<&str>,
) -> Result<String, String> {
    let normalized = normalize_global_quick_add_shortcut(shortcut)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Shortcut state lock poisoned".to_string())?;

    if *guard == normalized {
        return Ok(guard
            .clone()
            .unwrap_or_else(|| GLOBAL_QUICK_ADD_SHORTCUT_DISABLED.to_string()));
    }

    if let Some(existing) = guard.as_ref() {
        if let Err(error) = app.global_shortcut().unregister(existing.as_str()) {
            log::warn!("Failed to unregister existing quick add shortcut: {error}");
        }
    }

    if let Some(next_shortcut) = normalized.as_ref() {
        app.global_shortcut()
            .on_shortcut(next_shortcut.as_str(), move |app, _shortcut, _event| {
                show_quick_add_window(app);
            })
            .map_err(|error| format!("Failed to register global quick add shortcut: {error}"))?;
    }

    *guard = normalized.clone();
    Ok(normalized.unwrap_or_else(|| GLOBAL_QUICK_ADD_SHORTCUT_DISABLED.to_string()))
}

#[tauri::command]
pub(crate) fn set_global_quick_add_shortcut(
    app: tauri::AppHandle,
    state: tauri::State<'_, GlobalQuickAddShortcutState>,
    shortcut: Option<String>,
) -> Result<GlobalQuickAddShortcutApplyResult, String> {
    #[cfg(target_os = "linux")]
    if is_flatpak() {
        let disabled = apply_global_quick_add_shortcut(
            &app,
            &state,
            Some(GLOBAL_QUICK_ADD_SHORTCUT_DISABLED),
        )?;
        let requested_shortcut = shortcut.as_deref().unwrap_or("");
        let warning = if requested_shortcut.is_empty()
            || requested_shortcut.eq_ignore_ascii_case(GLOBAL_QUICK_ADD_SHORTCUT_DISABLED)
        {
            None
        } else {
            Some(
                "Flatpak/Wayland requires a desktop custom shortcut. Use: flatpak run tech.dongdongbh.mindwtr --quick-add"
                    .to_string(),
            )
        };
        return Ok(GlobalQuickAddShortcutApplyResult {
            shortcut: disabled,
            warning,
        });
    }

    match apply_global_quick_add_shortcut(&app, &state, shortcut.as_deref()) {
        Ok(applied) => Ok(GlobalQuickAddShortcutApplyResult {
            shortcut: applied,
            warning: None,
        }),
        Err(error) => {
            log::warn!(
                "Failed to apply global quick add shortcut; falling back to disabled: {error}"
            );
            let disabled = apply_global_quick_add_shortcut(
                &app,
                &state,
                Some(GLOBAL_QUICK_ADD_SHORTCUT_DISABLED),
            )?;
            Ok(GlobalQuickAddShortcutApplyResult {
                shortcut: disabled,
                warning: Some(
                    "Global quick add shortcut is unavailable (likely already used by another app), so it was disabled."
                        .to_string(),
                ),
            })
        }
    }
}

#[tauri::command]
pub(crate) fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub(crate) fn set_tray_visible(app: tauri::AppHandle, visible: bool) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id("main") {
        tray.set_visible(visible).map_err(|e| e.to_string())
    } else {
        log::warn!("set_tray_visible called but no tray icon exists");
        Ok(())
    }
}

pub(crate) fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_skip_taskbar(false);
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub(crate) fn show_main_and_emit(app: &tauri::AppHandle) {
    show_main(app);
    if let Ok(mut pending_target) = app.state::<QuickAddPending>().0.lock() {
        *pending_target = Some(QUICK_ADD_TARGET_MAIN.to_string());
    }
    let payload = QuickAddEventPayload {
        target: QUICK_ADD_TARGET_MAIN.to_string(),
    };
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit("quick-add", payload);
    } else {
        let _ = app.emit("quick-add", payload);
    }
}

pub(crate) fn create_quick_add_window(app: &tauri::AppHandle) -> Result<(), String> {
    if app.get_webview_window(QUICK_ADD_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        app,
        QUICK_ADD_WINDOW_LABEL,
        tauri::WebviewUrl::App(QUICK_ADD_WINDOW_URL.into()),
    )
    .title("Quick Add")
    .inner_size(QUICK_ADD_WINDOW_WIDTH, QUICK_ADD_WINDOW_HEIGHT)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .build()
    .map(|_| ())
    .map_err(|error| format!("Failed to create quick add window: {error}"))
}

fn quick_add_window_physical_size(scale_factor: f64) -> tauri::PhysicalSize<u32> {
    tauri::LogicalSize::new(QUICK_ADD_WINDOW_WIDTH, QUICK_ADD_WINDOW_HEIGHT)
        .to_physical(scale_factor)
}

fn centered_quick_add_position(
    work_area: &tauri::PhysicalRect<i32, u32>,
    window_size: &tauri::PhysicalSize<u32>,
) -> tauri::PhysicalPosition<i32> {
    let x_offset = work_area.size.width.saturating_sub(window_size.width) / 2;
    let y_offset = work_area.size.height.saturating_sub(window_size.height) / 2;
    tauri::PhysicalPosition::new(
        work_area.position.x + x_offset as i32,
        work_area.position.y + y_offset as i32,
    )
}

fn quick_add_target_monitor(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Option<tauri::Monitor> {
    app.cursor_position()
        .ok()
        .and_then(|position| {
            app.monitor_from_point(position.x, position.y)
                .ok()
                .flatten()
        })
        .or_else(|| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
}

fn center_quick_add_window(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let Some(monitor) = quick_add_target_monitor(app, window) else {
        if let Err(error) = window.center() {
            log::warn!("Failed to center quick add window: {error}");
        }
        return;
    };
    let window_size = quick_add_window_physical_size(monitor.scale_factor());
    let position = centered_quick_add_position(monitor.work_area(), &window_size);
    if let Err(error) = window.set_position(position) {
        log::warn!("Failed to position quick add window: {error}");
    }
}

pub(crate) fn show_quick_add_window(app: &tauri::AppHandle) {
    if let Ok(mut pending_target) = app.state::<QuickAddPending>().0.lock() {
        *pending_target = Some(QUICK_ADD_TARGET_WINDOW.to_string());
    }

    if let Some(window) = app.get_webview_window(QUICK_ADD_WINDOW_LABEL) {
        let _ = window.set_skip_taskbar(true);
        let _ = window.unminimize();
        center_quick_add_window(app, &window);
        let _ = window.show();
        let _ = window.set_focus();
        let payload = QuickAddEventPayload {
            target: QUICK_ADD_TARGET_WINDOW.to_string(),
        };
        let _ = window.emit("quick-add", payload);
        return;
    }

    log::warn!("Quick add window unavailable; falling back to the main window.");
    show_main_and_emit(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn centered_quick_add_position_uses_monitor_work_area() {
        let work_area = tauri::PhysicalRect {
            position: tauri::PhysicalPosition::new(100, -20),
            size: tauri::PhysicalSize::new(1200, 800),
        };
        let window_size = tauri::PhysicalSize::new(620, 420);

        assert_eq!(
            centered_quick_add_position(&work_area, &window_size),
            tauri::PhysicalPosition::new(390, 170)
        );
    }

    #[test]
    fn centered_quick_add_position_clamps_to_work_area_when_window_is_larger() {
        let work_area = tauri::PhysicalRect {
            position: tauri::PhysicalPosition::new(-1280, 0),
            size: tauri::PhysicalSize::new(500, 300),
        };
        let window_size = tauri::PhysicalSize::new(620, 420);

        assert_eq!(
            centered_quick_add_position(&work_area, &window_size),
            tauri::PhysicalPosition::new(-1280, 0)
        );
    }

    #[test]
    fn quick_add_window_physical_size_uses_monitor_scale_factor() {
        assert_eq!(
            quick_add_window_physical_size(2.0),
            tauri::PhysicalSize::new(1240, 840)
        );
    }
}

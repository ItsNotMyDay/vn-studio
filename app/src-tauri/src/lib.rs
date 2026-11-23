use tauri::{Manager, AppHandle};
use tauri_plugin_dialog::DialogExt;

async fn try_close_app(window: tauri::WebviewWindow) {
    // Показываем нативное диалоговое окно подтверждения
    let result = window
        .dialog()
        .message("Вы уверены, что хотите закрыть приложение?\nВсе несохранённые изменения будут потеряны.")
        .title("Подтверждение закрытия")
        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancel)
        .blocking_show();

    if result {
        let app = window.app_handle();
        
        // Выгружаем модели из AI-сервера перед выходом
        let client = reqwest::Client::new();
        let _ = client.post("http://127.0.0.1:8765/llm/unload").send().await;
        let _ = client.post("http://127.0.0.1:8765/model/unload").send().await;
        
        // Корректно завершаем приложение
        app.exit(0);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            let window_clone = window.clone();
            
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close(); // Останавливаем стандартное мгновенное закрытие
                    
                    // Запускаем асинхронную задачу для показа диалога и корректного закрытия
                    let w = window_clone.clone();
                    tauri::async_runtime::spawn(async move {
                        try_close_app(w).await;
                    });
                }
            });
            
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
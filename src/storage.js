import model from "./state.cjs";
let db;
export async function openStore() {
  db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("wenxiang-guancha-web", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("snapshots");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(Error("请关闭其他旧版闻香观茶标签页后重试"));
  });
  return readStore();
}
export async function readStore() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("snapshots"),
      r = tx.objectStore("snapshots").get("main");
    r.onsuccess = () => {
      try {
        resolve(r.result ? model.validate(r.result) : model.empty());
      } catch (e) {
        reject(e);
      }
    };
    r.onerror = () => reject(r.error);
  });
}
export async function saveStore(expectedRevision, mutator) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("snapshots", "readwrite"),
      store = tx.objectStore("snapshots"),
      r = store.get("main");
    let saved, failure;
    r.onsuccess = () => {
      try {
        const old = r.result || model.empty();
        if (old.revision !== expectedRevision)
          throw Error(
            "另一标签页已更新资料。当前输入仍保留，请先备份输入并刷新后重试。",
          );
        saved = model.clone(old);
        mutator(saved);
        saved.revision = old.revision + 1;
        model.validate(saved);
        store.put(saved, "main");
      } catch (e) {
        failure = e;
        tx.abort();
      }
    };
    tx.oncomplete = () => resolve(saved);
    tx.onabort = () =>
      reject(failure || tx.error || Error("保存失败，请检查浏览器存储空间"));
    tx.onerror = () => {
      failure = tx.error;
    };
  });
}

import styles from './ViewModeSwitch.module.css';

/** «Свой профиль / Конкуренты» on the network page; competitors arrive in a later release. */
export function ViewModeSwitch() {
  return (
    <div className={styles.group} role="group" aria-label="Режим">
      <button type="button" className={styles.active} aria-pressed="true">Свой профиль</button>
      <button type="button" className={styles.option} aria-pressed="false" disabled>
        Конкуренты <span className={styles.soon}>Скоро</span>
      </button>
    </div>
  );
}

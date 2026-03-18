import { useMemo, useState, type FormEvent } from 'react';
import type { RegisterPayload } from '../types/api';

interface RegistrationFormProps {
  loading: boolean;
  onSubmit: (payload: RegisterPayload) => Promise<void>;
}

type FormErrors = Partial<Record<keyof RegisterPayload, string>>;

const initialForm: RegisterPayload = {
  firstName: '',
  lastName: '',
  middleName: '',
  groupNumber: '',
  email: '',
  phone: '',
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phonePattern = /^[+]?[0-9()\-\s]{10,20}$/;

export function RegistrationForm({ loading, onSubmit }: RegistrationFormProps) {
  const [form, setForm] = useState<RegisterPayload>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});

  const fields = useMemo(
    () => [
      { key: 'firstName', label: 'Имя', type: 'text' },
      { key: 'lastName', label: 'Фамилия', type: 'text' },
      { key: 'middleName', label: 'Отчество', type: 'text' },
      { key: 'groupNumber', label: 'Группа', type: 'text' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Телефон', type: 'tel' },
    ] as const,
    [],
  );

  const validate = (): FormErrors => {
    const nextErrors: FormErrors = {};

    if (!form.firstName.trim()) nextErrors.firstName = 'Введите имя';
    if (!form.lastName.trim()) nextErrors.lastName = 'Введите фамилию';
    if (!form.middleName.trim()) nextErrors.middleName = 'Введите отчество';
    if (!form.groupNumber.trim()) nextErrors.groupNumber = 'Введите номер группы';
    if (!emailPattern.test(form.email.trim())) nextErrors.email = 'Введите корректный email';
    if (!phonePattern.test(form.phone.trim())) nextErrors.phone = 'Введите корректный телефон';

    return nextErrors;
  };

  const handleChange = (key: keyof RegisterPayload, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors = validate();
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    await onSubmit({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      middleName: form.middleName.trim(),
      groupNumber: form.groupNumber.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
    });
  };

  return (
    <section className="rounded-[28px] border border-slate-200/70 bg-white/90 p-5 shadow-panel backdrop-blur xl:p-6">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">
          Регистрация
        </p>
        <h2 className="mt-1 text-xl font-semibold text-ink">Лицо не найдено в системе</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Заполните данные нового пользователя. Для регистрации будет использован уже
          захваченный кадр после успешной liveness-проверки.
        </p>
      </div>

      <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
        {fields.map((field) => {
          const error = errors[field.key];

          return (
            <label key={field.key} className="block">
              <span className="mb-2 block text-sm font-medium text-slate-700">{field.label}</span>
              <input
                type={field.type}
                value={form[field.key]}
                onChange={(event) => handleChange(field.key, event.target.value)}
                className={`w-full rounded-2xl border bg-slate-50 px-4 py-3 text-sm text-ink outline-none transition placeholder:text-slate-400 focus:border-accent focus:bg-white ${
                  error ? 'border-red-300' : 'border-slate-200'
                }`}
                placeholder={`Введите ${field.label.toLowerCase()}`}
              />
              {error ? <span className="mt-2 block text-xs text-danger">{error}</span> : null}
            </label>
          );
        })}

        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {loading ? 'Регистрация...' : 'Зарегистрировать пользователя'}
          </button>
        </div>
      </form>
    </section>
  );
}

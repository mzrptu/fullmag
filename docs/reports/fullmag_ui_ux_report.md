# Raport Audytu UI/UX: Fullmag Web Frontend

Ten raport przedstawia globalną analizę kodu frontendowego (Next.js App Router) aplikacji Fullmag, ze szczególnym uwzględnieniem designu UI/UX, estetyki, zarządzania kolorami oraz poprawności wdrożenia bibliotek Tailwind CSS i Shadcn UI. Celem audytu jest identyfikacja długów technologicznych oraz wskazanie ścieżki do stworzenia wysoce spójnego, designerskiego interfejsu ("premium feel").

---

## 1. Diagnoza Stanu Obecnego (Co nie działa?)

Obecnie aplikacja cierpi na **ciężką fragmentację systemów stylowania**. Próbuje połączyć trzy zupełnie różne paradygmaty, co prowadzi do niespójności wizualnej i trudności w utrzymaniu kodu.

### A. Fragmentacja Systemów Toksów (Zmienne CSS)
W pliku `app/globals.css` zdefiniowano obok siebie trzy niezależne, konkurujące systemy zmiennych:
1. **System IDE** (`--ide-bg`, `--ide-surface`, `--ide-accent`): Przypisany głównie do widoku `RunControlRoom`.
2. **System Amumax (Port)** (`--surface-1`, `--am-accent`, `--border-interactive`): Przeniesiony z innej aplikacji.
3. **Hardcodowane kolory**: Bezpośrednie definicje jak `hsla(210, 70%, 50%, 0.08)` lub `hsl(210, 70%, 55%)` wewnątrz Tailwindowych klas (np. w `components/ui/tabs.tsx`).

> [!WARNING]
> Brak jednego źródła prawdy ("Single Source of Truth") dla kolorów powoduje, że wywołanie zmiany schematu (np. przejście na tryb jasny) jest praktycznie niemożliwe bez setek poprawek.

### B. Błędne wykorzystanie Shadcn UI i Tailwind CSS
Aplikacja ma zainstalowanego Tailwinda v4 i zadeklarowany plik `components.json` (Shadcn), ale ich wykorzystanie jest powierzchowne:
- **CSS Modules vs Tailwind:** Pomimo obecności Tailwinda, ogromna większość komponentów używa przestarzałego podejścia CSS Modules (np. `Button.tsx` -> `Button.module.css`, `Panel.module.css`). Jest to absolutny antywzorzec w ekosystemie Tailwinda.
- **Brak standardowych zmiennych Shadcn:** Shadcn UI opiera się na specyficznych zmiennych CSS (np. `--background`, `--foreground`, `--primary`, `--border`, `--card`, `--muted`). Plik `globals.css` ich **nie posiada**, przez co nieliczne wdrożone komponenty Shadcn (np. `switch.tsx`) zostały ręcznie zhakowane, aby używać zmiennych `--am-accent` wewnątrz definicji `cn(...)`.

### C. Estetyka i UI/UX
Aktualnie design jest "techniczno-surowy". Użytkownik widzi aplikację o strukturze rodem z 2018 roku, gdzie króluje czysty, ciemny blok tła i twarde linie siatki. Odczucie premium (tzw. "glassmorphism", nowoczesna głębia, miękkie przejścia tonalne) jest obecne jedynie połowicznie w pliku konfiguracyjnym, ale nie wylewa się na komponenty ze względu na użycie CSS Modules ograniczających przezroczystość bloku.

---

## 2. Docelowy Projekt Architektury UI (Co musimy zmienić globalnie?)

Zamiast poprawiać pojedyncze elementy, musimy **zaorać obecny system stylów** i przejść na jednolity, rygorystyczny paradygmat: **W 100% zintegrowany Shadcn UI + Tailwind CSS v4**.

### A. Ujednolicenie Tokenów Kolorystycznych (Paleta "Premium Dark")

Musimy wyczyścić `globals.css` i wprowadzić zgodny z Shadcn system tokenów. Aby uzyskać nowoczesny, nasycony i profesjonalny wygląd narzędzia inżynieryjnego, proponuję następującą paletę w stylu "Midnight Science":

```css
@theme {
  --color-background: hsl(222, 47%, 5%);     /* Bardzo głęboki, chłodny granat - nie czysty czarny */
  --color-foreground: hsl(210, 40%, 98%);    /* Jasny, lekko chłodny biały */

  --color-card: hsl(222, 47%, 7%);           /* Tło paneli (lekko jaśniejsze od tła) */
  --color-card-foreground: hsl(210, 40%, 98%);

  --color-popover: hsl(222, 47%, 7%);
  --color-popover-foreground: hsl(210, 40%, 98%);

  --color-primary: hsl(217, 91%, 60%);       /* Dynamiczny, "jarzący się" błękit laboratoryjny */
  --color-primary-foreground: hsl(0, 0%, 100%);

  --color-secondary: hsl(217, 32%, 17%);     /* Subtelny akcent do teł przycisków typu ghost */
  --color-secondary-foreground: hsl(210, 40%, 98%);

  --color-muted: hsl(217, 32%, 17%);
  --color-muted-foreground: hsl(215, 20%, 65%);

  --color-accent: hsl(217, 32%, 17%);
  --color-accent-foreground: hsl(210, 40%, 98%);

  --color-destructive: hsl(0, 84%, 60%);     /* Krwista, technologiczna czerwień dla błędów */
  --color-destructive-foreground: hsl(210, 40%, 98%);

  --color-border: hsl(217, 32%, 17%);        /* Niskokontrastowe granice paneli */
  --color-input: hsl(217, 32%, 17%);
  --color-ring: hsl(217, 91%, 60%);          /* Podświetlenia focus */

  --radius: 0.75rem;                         /* Zwiększony radius dla miękkości (12px) */
}
```

Dzięki temu jednemu mapowaniu cała aplikacja i biblioteka komponentów zyskają idealnie spójny wygląd bez użycia `.module.css` czy hardcodowanych wartości.

---

### B. Pełna migracja do Shadcn UI (Usunięcie .module.css)

Obecnie w `components/ui/` znajduje się mnóstwo "samoróbek" podłączonych pod CSS module. Należy je brutalnie podmienić na ustandaryzowane komponenty generowane przez CLI Shadcn (`npx shadcn@latest add ...`).

#### Komponenty do wymiany 1:1 na Shadcn:
1. **`Button.tsx` (i `Button.module.css`)** -> Zamień na standardowy `button.tsx` od Shadcn. Posiada on natywną obsługę wariantów (`default`, `destructive`, `outline`, `secondary`, `ghost`, `link`), co całkowicie wyeliminuje Twój customowy plik.
2. **`TextField.tsx`** -> Zamień na Shadcn `input.tsx`.
3. **`SelectField.tsx`** -> Zamień na Shadcn `select.tsx`.
4. **`Toggle.tsx`** -> Zamień na Shadcn `toggle.tsx`.
5. **`Slider.tsx`** -> Zamień na Shadcn `slider.tsx`.
6. **`Panel.tsx` (i `Panel.module.css`)** -> Zamień na układ oparty o kompozycje Shadcn `Card` (`Card`, `CardHeader`, `CardTitle`, `CardContent`). Zapewnia to natywny glassmorphism.
7. **`StatusBadge.tsx` / `badge.tsx`** -> Ujednolicenie! Obecnie istnieją dwa badge (jeden używający CSSModules, drugi Tailwind). Należy pozostawić jeden (shadcn `badge.tsx`) i poszerzyć go o nowe warianty (success, warning) w `cva()`.

#### Wizualizacja wymiany kodu:
*Przed (Stare podejście .module.css):*
```tsx
import s from "./Button.module.css";
// ... ręczne łączenie klas
<button className={`${s.uiButton} ${s[variant]}`}>{children}</button>
```

*Po (Nowoczesne podejście Shadcn / Tailwind):*
```tsx
import { Button } from "@/components/ui/button";
<Button variant="outline" size="sm">{children}</Button>
```

---

### C. Redesign Głównego Układu (Global Layout)

Globalny layout (`AppLayout.tsx`) wciąż korzysta z klas CSS Modules `grid-area: sidebar` itd. Należy przepisać główną siatkę na czysty Tailwind, aby wszystkie odstępy reagowały na systematykę `gap-` i paddingów, np.:

```tsx
export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
      <Sidebar className="w-64 border-r bg-card/50 backdrop-blur-xl" />
      <div className="flex flex-col flex-1">
        <TopBar className="h-14 border-b bg-background/80 backdrop-blur-xl" />
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto space-y-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
```

> [!TIP]
> Użycie `bg-card/50` wraz z `backdrop-blur-xl` z miejsca da tak pożądany, naśladujący natywne oprogramowanie "macOS-like Premium Feel", w miejsce twardych kolorów z CSS-Modules.

---

## 3. Plan Działania i Priorytety z perspektywy dewelopera

Podsumowując, próba lokalnych, "drobnych poprawek" obecnych komponentów tylko pogłębi dłuk technologiczny. Oto sekwencja działań, którą proponuję wdrożyć globalnie:

| Etap | Zadanie | Znaczenie w projekcie |
|---|---|---|
| **Etap 1: Fundamenty** | Czyszczenie `app/globals.css`. Wprowadzenie standardowych zmiennych CSS dla Shadcn UI (zgodnych z Tailwind v4, ujętych w dyrektrywie `@theme`). | Krytyczne. Pozwoli na bezkolizyjne stosowanie kolorów w stylu `bg-primary`, `border-border`, a nie hakowych `[var(--ide-bg)]`. |
| **Etap 2: CLI Shadcn** | Uruchomienie `npx shadcn@latest add ...` dla wszystkich bazowych mechanik (Button, Input, Card, Badge, Slider). | Ustandaryzuje 80% formularzy w aplikacji i zmniejszy pliki konfiguracyjne. |
| **Etap 3: Czystka Legacy** | Usunięcie katalogowo wszystkich plików `*.module.css` z folderu `components/ui/` oraz starych komponentów `*.tsx`. Zastąpienie ich importami z nowej struktury shadcn. | Przejście z hybrydowego (wymieszanego) stosu na prawdziwy ekosystem Tailwind. |
| **Etap 4: Polerowanie i Glassmorphism** | Wprowadzenie `backdrop-blur-md bg-background/60` (Tailwind Utilities) w oparciu o nowe tokeny, na elementach takich jak `Sidebar.tsx`, `TitleBar.tsx` i Panelach nawigacyjnych widoku `run-control`. | Wywoła ostateczny "WOW effect", tworząc głębię obrazu w przeglądarce 3D. |

Jeśli jesteś na to gotowy, możemy zacząć wdrażać te kroki natychmiast — zaczynając od refaktoryzacji `globals.css` pod Shadcn!

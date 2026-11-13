import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpDown,
  AlertTriangle,
  BadgeCheck,
  Ban,
  BarChart3,
  Beef,
  Building2,
  Car,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Coffee,
  Compass,
  Copy,
  Croissant,
  Download,
  Droplet,
  Egg,
  Flag,
  Footprints,
  Home,
  Info,
  Leaf,
  ListChecks,
  LocateFixed,
  MapPin,
  Milk,
  Minus,
  Navigation,
  Package,
  Pencil,
  PiggyBank,
  Plus,
  PlusCircle,
  RotateCcw,
  Route,
  Search,
  ShoppingBasket,
  ShoppingCart,
  SlidersHorizontal,
  Snowflake,
  Sparkles,
  SprayCan,
  Store,
  Trash2,
  Utensils,
  WashingMachine,
  Wheat,
  X,
} from "lucide-react";

export type HearthIconName =
  | "eco"
  | "arrow_forward"
  | "arrow_back"
  | "tune"
  | "check"
  | "check_circle"
  | "chevron_right"
  | "expand_more"
  | "shopping_basket"
  | "storefront"
  | "store"
  | "travel_explore"
  | "explore"
  | "receipt_long"
  | "location_city"
  | "home_pin"
  | "location_on"
  | "person_pin_circle"
  | "my_location"
  | "near_me"
  | "navigation"
  | "kitchen"
  | "grain"
  | "bakery_dining"
  | "water_drop"
  | "oil_barrel"
  | "coffee"
  | "local_cafe"
  | "ac_unit"
  | "local_drink"
  | "water_bottle"
  | "set_meal"
  | "egg"
  | "cleaning_services"
  | "local_laundry_service"
  | "countertops"
  | "sanitizer"
  | "soap"
  | "inventory_2"
  | "add"
  | "remove"
  | "add_circle"
  | "edit"
  | "delete"
  | "search"
  | "close"
  | "cancel"
  | "block"
  | "info"
  | "analytics"
  | "verified"
  | "savings"
  | "alt_route"
  | "swap_calls"
  | "swap_vert"
  | "shopping_cart"
  | "content_copy"
  | "download"
  | "report_problem"
  | "flag"
  | "restart_alt"
  | "directions_walk"
  | "directions_car"
  | "checklist"
  | "auto_awesome"
  | (string & {});

interface HearthIconProps {
  name: HearthIconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

/**
 * Pure SVG icon mapper using lucide-react so browser auto-translation
 * or font load timing never falls back to raw ligature text (e.g. "Flecha").
 */
export default function HearthIcon({
  name,
  size = 18,
  className,
  strokeWidth = 2,
}: HearthIconProps) {
  const props = {
    size,
    strokeWidth,
    className,
    "aria-hidden": true as const,
  };

  switch (name) {
    case "eco":
      return <Leaf {...props} />;
    case "arrow_forward":
      return <ArrowRight {...props} />;
    case "arrow_back":
      return <ArrowLeft {...props} />;
    case "tune":
      return <SlidersHorizontal {...props} />;
    case "check":
      return <Check {...props} />;
    case "check_circle":
      return <CircleCheck {...props} />;
    case "chevron_right":
      return <ChevronRight {...props} />;
    case "expand_more":
      return <ChevronDown {...props} />;
    case "shopping_basket":
      return <ShoppingBasket {...props} />;
    case "storefront":
    case "store":
    case "receipt_long":
      return <Store {...props} />;
    case "travel_explore":
    case "explore":
      return <Compass {...props} />;
    case "location_city":
      return <Building2 {...props} />;
    case "home_pin":
      return <Home {...props} />;
    case "location_on":
    case "person_pin_circle":
      return <MapPin {...props} />;
    case "my_location":
      return <LocateFixed {...props} />;
    case "near_me":
    case "navigation":
      return <Navigation {...props} />;
    case "kitchen":
      return <Utensils {...props} />;
    case "grain":
      return <Wheat {...props} />;
    case "bakery_dining":
      return <Croissant {...props} />;
    case "water_drop":
    case "oil_barrel":
      return <Droplet {...props} />;
    case "coffee":
    case "local_cafe":
      return <Coffee {...props} />;
    case "ac_unit":
      return <Snowflake {...props} />;
    case "local_drink":
    case "water_bottle":
      return <Milk {...props} />;
    case "set_meal":
      return <Beef {...props} />;
    case "egg":
      return <Egg {...props} />;
    case "cleaning_services":
    case "soap":
    case "auto_awesome":
      return <Sparkles {...props} />;
    case "local_laundry_service":
      return <WashingMachine {...props} />;
    case "countertops":
    case "sanitizer":
      return <SprayCan {...props} />;
    case "inventory_2":
      return <Package {...props} />;
    case "add":
      return <Plus {...props} />;
    case "remove":
      return <Minus {...props} />;
    case "add_circle":
      return <PlusCircle {...props} />;
    case "edit":
      return <Pencil {...props} />;
    case "delete":
      return <Trash2 {...props} />;
    case "search":
      return <Search {...props} />;
    case "close":
    case "cancel":
      return <X {...props} />;
    case "block":
      return <Ban {...props} />;
    case "info":
      return <Info {...props} />;
    case "analytics":
      return <BarChart3 {...props} />;
    case "verified":
      return <BadgeCheck {...props} />;
    case "savings":
      return <PiggyBank {...props} />;
    case "alt_route":
      return <Route {...props} />;
    case "swap_calls":
      return <ArrowLeftRight {...props} />;
    case "swap_vert":
      return <ArrowUpDown {...props} />;
    case "shopping_cart":
      return <ShoppingCart {...props} />;
    case "content_copy":
      return <Copy {...props} />;
    case "download":
      return <Download {...props} />;
    case "report_problem":
      return <AlertTriangle {...props} />;
    case "flag":
      return <Flag {...props} />;
    case "restart_alt":
      return <RotateCcw {...props} />;
    case "directions_walk":
      return <Footprints {...props} />;
    case "directions_car":
      return <Car {...props} />;
    case "checklist":
      return <ListChecks {...props} />;
    default:
      return <Package {...props} />;
  }
}

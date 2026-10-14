from datetime import date
from typing import List, Optional, Literal
from pydantic import BaseModel, Field, EmailStr, field_validator

ProjectStatus = Literal["preparation", "actif", "suspendu", "en_retard", "en_reception", "livre", "archive"]
TaskStatus = Literal["a_planifier", "a_faire", "en_cours", "bloque", "termine", "annule"]
DepType = Literal["FS", "SS", "FF", "SF"]


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class ProjectIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    reference: str = Field(min_length=2, max_length=40, pattern=r"^[A-Za-z0-9_\-\.]+$")
    description: str = Field(default="", max_length=4000)
    operation_type: str = Field(default="Construction neuve", max_length=80)
    address: str = Field(default="", max_length=300)
    client: str = Field(default="", max_length=160)
    architect: str = Field(default="", max_length=160)
    start_planned: date
    end_planned: Optional[date] = None
    budget_initial: Optional[str] = Field(default=None, pattern=r"^\d{1,13}(\.\d{1,2})?$")


class ProjectPatch(BaseModel):
    version: int
    name: Optional[str] = Field(default=None, min_length=2, max_length=160)
    description: Optional[str] = Field(default=None, max_length=4000)
    operation_type: Optional[str] = Field(default=None, max_length=80)
    address: Optional[str] = Field(default=None, max_length=300)
    client: Optional[str] = Field(default=None, max_length=160)
    architect: Optional[str] = Field(default=None, max_length=160)
    start_planned: Optional[date] = None
    end_planned: Optional[date] = None


class StatusChangeIn(BaseModel):
    status: ProjectStatus
    reason: str = Field(default="", max_length=500)


class CalendarException(BaseModel):
    date: date
    type: Literal["ferie", "ouvre"] = "ferie"
    label: str = Field(default="", max_length=120)


class CalendarIn(BaseModel):
    working_days: List[int] = Field(min_length=1, max_length=7)
    exceptions: List[CalendarException] = Field(default_factory=list, max_length=500)

    @field_validator("working_days")
    @classmethod
    def _wd(cls, v: List[int]) -> List[int]:
        if any(d < 0 or d > 6 for d in v):
            raise ValueError("Jours ouvrés invalides (0=lundi … 6=dimanche)")
        return sorted(set(v))


class TaskIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    code: Optional[str] = Field(default=None, max_length=30)
    description: str = Field(default="", max_length=4000)
    lot: str = Field(default="", max_length=80)
    zone: str = Field(default="", max_length=80)
    company: str = Field(default="", max_length=120)
    responsible: str = Field(default="", max_length=120)
    start: date
    duration: int = Field(ge=0, le=2000)
    is_milestone: bool = False
    priority: Literal["basse", "normale", "haute", "critique"] = "normale"
    status: TaskStatus = "a_faire"


class TaskPatch(BaseModel):
    version: int
    name: Optional[str] = Field(default=None, min_length=2, max_length=200)
    code: Optional[str] = Field(default=None, max_length=30)
    description: Optional[str] = Field(default=None, max_length=4000)
    lot: Optional[str] = Field(default=None, max_length=80)
    zone: Optional[str] = Field(default=None, max_length=80)
    company: Optional[str] = Field(default=None, max_length=120)
    responsible: Optional[str] = Field(default=None, max_length=120)
    start: Optional[date] = None
    duration: Optional[int] = Field(default=None, ge=0, le=2000)
    is_milestone: Optional[bool] = None
    priority: Optional[Literal["basse", "normale", "haute", "critique"]] = None
    status: Optional[TaskStatus] = None
    exception_reason: Optional[str] = Field(default=None, max_length=500)


class MoveIn(BaseModel):
    start: date
    duration: Optional[int] = Field(default=None, ge=0, le=2000)


class ProgressIn(BaseModel):
    progress: int = Field(ge=0, le=100)
    date: date
    comment: str = Field(default="", max_length=1000)


class DependencyIn(BaseModel):
    predecessor_id: str
    successor_id: str
    type: DepType = "FS"
    lag: int = Field(default=0, ge=-365, le=365)


class BaselineIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)


class RuleFilters(BaseModel):
    ifc_types: List[str] = Field(default_factory=list)
    storeys: List[str] = Field(default_factory=list)
    disciplines: List[str] = Field(default_factory=list)
    name_contains: str = Field(default="", max_length=120)
    property_name: str = Field(default="", max_length=120)
    property_value: str = Field(default="", max_length=200)


class RulePreviewIn(BaseModel):
    model_id: str
    filters: RuleFilters


class RuleIn(RulePreviewIn):
    task_id: str
    name: str = Field(min_length=2, max_length=160)


class LinkIn(BaseModel):
    task_id: str
    model_id: str
    global_ids: List[str] = Field(min_length=1, max_length=20000)
